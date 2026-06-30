const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const bcrypt = require('bcryptjs'); // ✅ usa bcryptjs

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

pool.query('SELECT NOW()', (err, res) => {
    if (err) console.error('❌ Error con Neon:', err.message);
    else console.log('🚀 Conectado a Neon:', res.rows[0].now);
});

// CASO 1: REGISTRO
app.post('/api/registro', async (req, res) => {
    const { nombre, email, password, rut, num_documento } = req.body;

    if (!nombre || !email || !password || !rut) {
        return res.status(400).json({ message: "Todos los campos son obligatorios" });
    }

    try {
        const validarEmail = await pool.query(
            'SELECT * FROM usuarios WHERE email = $1', [email]
        );
        if (validarEmail.rows.length > 0) {
            return res.status(400).json({ message: "El correo ya está registrado" });
        }

        const passwordHasheada = await bcrypt.hash(password, 10);

        await pool.query(
            `INSERT INTO usuarios (
                nombre, email, password_hash, rut_encriptado, num_documento_encriptado, tipo_usuario
            ) VALUES ($1, $2, $3, $4::bytea, $5::bytea, 1)`,
            [
                nombre,
                email,
                passwordHasheada,
                Buffer.from(rut),
                num_documento ? Buffer.from(num_documento) : null 
            ]
        );
        res.json({ message: "¡Cuenta creada con éxito! Registrado como Voluntario." });
    } catch (err) {
        console.error('❌ Error en /api/registro:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// CASO 2: LOGIN
app.post('/api/login', async (req, res) => {
    const { email, password } = req.body;

    if (!email || !password) {
        return res.status(400).json({ message: "Correo y contraseña requeridos" });
    }

    try {
        const usuarioQuery = await pool.query(
            'SELECT usuario_id, nombre, email, tipo_usuario, password_hash FROM usuarios WHERE email = $1',
            [email]
        );

        if (usuarioQuery.rows.length === 0) {
            return res.status(401).json({ message: "Credenciales incorrectas" });
        }

        const usuario = usuarioQuery.rows[0];
        const passwordValida = await bcrypt.compare(password, usuario.password_hash);

        if (!passwordValida) {
            return res.status(401).json({ message: "Credenciales incorrectas" });
        }

        res.json({
            message: "Ingreso exitoso",
            usuario: {
                id: usuario.usuario_id,
                nombre: usuario.nombre,
                email: usuario.email,
                tipo_usuario: usuario.tipo_usuario || 1
            }
        });
    } catch (err) {
        console.error('❌ Error en /api/login:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// UPGRADE A ORGANIZADOR
app.post('/api/upgrade', async (req, res) => {
    const { id, num_documento } = req.body;

    if (!id || !num_documento) {
        return res.status(400).json({ message: "Datos insuficientes para el ascenso." });
    }

    try {
        const resultado = await pool.query(
            `UPDATE usuarios 
             SET tipo_usuario = 2, 
                 num_documento_encriptado = convert_to($1, 'UTF8') 
             WHERE usuario_id = $2 
             RETURNING *`,
            [num_documento, id]
        );

        if (resultado.rows.length === 0) {
            return res.status(404).json({ message: "El usuario no existe." });
        }

        res.json({ message: "¡Validación aprobada! Ahora eres Organizador Verificado." });
    } catch (err) {
        console.error('❌ Error en /api/upgrade:', err.message);
        res.status(500).json({ error: "Error de servidor al validar el documento." });
    }
});

// CASO 3: CREAR EVENTO
app.post('/api/eventos', async (req, res) => {
    const { titulo, descripcion, tipo_evento, direccion, latitud, longitud, fecha_evento, creado_por } = req.body;

    if (!titulo || !descripcion || !tipo_evento || !direccion || !latitud || !longitud || !fecha_evento || !creado_por) {
        return res.status(400).json({ message: "Faltan campos obligatorios para crear el evento." });
    }

    try {
        const nuevoEvento = await pool.query(
            `INSERT INTO voluntariados (titulo, descripcion, tipo_evento, direccion, latitud, longitud, fecha_evento, creado_por) 
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
            [titulo, descripcion, tipo_evento, direccion, latitud, longitud, fecha_evento, creado_por]
        );

        res.status(201).json({ 
            message: "¡Evento publicado con éxito en el mapa!",
            evento: nuevoEvento.rows[0]
        });

    } catch (err) {
        console.error('❌ Error al insertar evento en la base de datos:', err.message);
        res.status(500).json({ error: "Error interno del servidor al registrar el punto de voluntariado" });
    }
});

// LEER EVENTOS (Se añadió la columna v.reportes)
app.get('/api/eventos', async (req, res) => {
    try {
        const queryEventos = await pool.query(`
            SELECT 
                v.punto_id,  
                v.titulo,
                v.descripcion,
                v.tipo_evento,
                v.direccion,
                v.latitud,
                v.longitud,
                v.fecha_evento,
                v.creado_por,
                v.reportes, 
                u.nombre AS nombre_creador
            FROM voluntariados v 
            INNER JOIN usuarios u ON v.creado_por = u.usuario_id
        `); // 🚀 v.reportes añadido aquí arriba
        
        res.json(queryEventos.rows); 
    } catch (err) {
        console.error('❌ Error en /api/eventos (GET):', err.message);
        res.status(500).json({ error: "Error al leer puntos desde Neon Tech" });
    }
});

// 🚩 NUEVO: RUTA PARA REPORTAR UN EVENTO FALSO
app.put('/api/eventos/reportar/:id', async (req, res) => {
    const eventoId = req.params.id; // Recibimos el id del evento por la URL

    try {
        // Actualizamos de forma atómica: Si es nulo lo tratamos como 0, y sumamos 1.
        const resultado = await pool.query(
            `UPDATE voluntariados 
             SET reportes = COALESCE(reportes, 0) + 1 
             WHERE punto_id = $1 
             RETURNING reportes`,
            [eventoId]
        );

        // Si la base de datos no encontró el evento para actualizar
        if (resultado.rows.length === 0) {
            return res.status(404).json({ message: "Evento no encontrado en la base de datos." });
        }

        // Respondemos con éxito a la app de Android
        res.json({ 
            message: "Reporte sumado con éxito",
            reportes_actuales: resultado.rows[0].reportes
        });
    } catch (err) {
        console.error('❌ Error en /api/eventos/reportar:', err.message);
        res.status(500).json({ error: "Error de servidor al intentar reportar el evento." });
    }
});
// 🟢 1. RUTA PARA INSCRIBIRSE A UN VOLUNTARIADO
app.post('/api/inscripciones', async (req, res) => {
    const { usuario_id, voluntario_id } = req.body;
    try {
        await pool.query(
            `INSERT INTO inscripciones_voluntariados (usuario_id, voluntario_id) VALUES ($1, $2)`,
            [usuario_id, voluntario_id]
        );
        res.json({ message: "¡Te has inscrito exitosamente!" });
    } catch (err) {
        // El código 23505 es el error de UNIQUE constraint (ya está inscrito)
        if (err.code === '23505') {
            return res.status(400).json({ error: "Ya estás inscrito en este voluntariado." });
        }
        console.error('❌ Error al inscribir:', err.message);
        res.status(500).json({ error: "Error en el servidor al procesar la inscripción." });
    }
});

// 🟢 2. RUTA: MIS VOLUNTARIADOS (Basado en tu documento)
// 🟢 2. RUTA MEJORADA: MIS VOLUNTARIADOS (Sin usar funciones de Neon)
app.post('/api/mis-voluntariados', async (req, res) => {
    const { usuario_id } = req.body;
    try {
        // Hacemos el JOIN directamente en SQL puro (más seguro)
        const query = await pool.query(`
            SELECT 
                v.punto_id AS inscripcion_id,
                'Reciente' AS fecha_inscripcion,
                v.punto_id AS id,
                v.titulo,
                v.descripcion,
                v.tipo_evento,
                v.direccion,
                v.fecha_evento
            FROM inscripciones_voluntariados i
            INNER JOIN voluntariados v ON i.voluntario_id = v.punto_id
            WHERE i.usuario_id = $1
        `, [usuario_id]);
        
        // Node.js se encarga de armar el "molde" que Android espera
        const resultados = query.rows.map(row => ({
            inscripcion_id: row.inscripcion_id,
            fecha_inscripcion: row.fecha_inscripcion,
            voluntariado: {
                id: row.id,
                titulo: row.titulo,
                descripcion: row.descripcion,
                tipo_evento: row.tipo_evento,
                direccion: row.direccion,
                fecha_evento: row.fecha_evento
            }
        }));

        // Enviamos la lista perfecta a Android
        res.json(resultados);
        
    } catch (err) {
        console.error('❌ Error al cargar mis voluntariados:', err.message);
        res.status(500).json({ error: "Error del servidor" });
    }
});

// 🟢 3. RUTA: VER INSCRITOS (Para el Creador)
app.get('/api/eventos/:id/inscritos', async (req, res) => {
    const eventoId = req.params.id;
    try {
        const query = await pool.query(`
            SELECT u.nombre, convert_from(u.rut_encriptado, 'UTF8') AS rut
            FROM inscripciones_voluntariados i
            INNER JOIN usuarios u ON i.usuario_id = u.usuario_id
            WHERE i.voluntario_id = $1
        `, [eventoId]);
        res.json(query.rows);
    } catch (err) {
        console.error('❌ Error al cargar inscritos:', err.message);
        res.status(500).json({ error: "Error del servidor" });
    }
});
app.listen(PORT, () => {
    console.log(`📡 Backend corriendo y escuchando en el puerto ${PORT}`);
});
