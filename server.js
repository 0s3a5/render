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
            ) VALUES ($1, $2, $3, $4::bytea, $5::bytea, 1)`, // ✅ El ::bytea le quita la confusión a Postgres
            [
                nombre,
                email,
                passwordHasheada,
                Buffer.from(rut),
                num_documento ? Buffer.from(num_documento) : null // ✅ Si no viene, se guarda como NULL en vez de romper
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
        return res.status(400).json({ message: "Datos insuficientes para el ascenso" });
    }

    try {
        // Al actualizar, dejamos en claro que pasa a tipo_usuario = 2 (Organizador Verificado)
        const resultado = await pool.query(
            `UPDATE usuarios 
             SET num_documento_encriptado = convert_to($1, 'UTF8'), 
                 tipo_usuario = 2 
             WHERE usuario_id = $2 RETURNING *`,
            [num_documento, id]
        );

        if (resultado.rows.length === 0) {
            return res.status(404).json({ message: "El usuario no existe en el sistema" });
        }

        res.json({ message: "¡Validación aprobada! Ahora eres Organizador Verificado." });
    } catch (err) {
        console.error('❌ Error en /api/upgrade:', err.message);
        res.status(500).json({ error: "Error de servidor al validar el documento" });
    }
});
// CASO 3: CREAR EVENTO
app.post('/api/eventos', async (req, res) => {
    // Desestructuramos lo que envía Android (los nombres gracias al @SerializedName de arriba)
    const { titulo, descripcion, tipo_evento, direccion, latitud, longitud, fecha_evento, creado_por } = req.body;

    // Validación básica en el servidor
    if (!titulo || !descripcion || !tipo_evento || !direccion || !latitud || !longitud || !fecha_evento || !creado_por) {
        return res.status(400).json({ message: "Faltan campos obligatorios para crear el evento." });
    }

    try {
        // Insertamos en Neon Tech omitiendo el ID para que la base de datos use su propio autoincrementable
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

// LEER EVENTOS
app.get('/api/eventos', async (req, res) => {
    try {
        const queryEventos = await pool.query(`
            SELECT 
                e.punto_id,  
                e.titulo,
                e.descripcion,
                e.tipo_evento,
                e.direccion,
                e.latitud,
                e.longitud,
                e.fecha_evento,
                e.creado_por,
                u.nombre AS nombre_creador
            FROM voluntariados v 
            INNER JOIN usuarios u ON v.creado_por = u.usuario_id
        `);
        
        res.json(queryEventos.rows); 
    } catch (err) {
        console.error('❌ Error en /api/eventos (GET):', err.message);
        res.status(500).json({ error: "Error al leer puntos desde Neon Tech" });
    }
});
app.listen(PORT, () => {
    console.log(`📡 Backend corriendo y escuchando en el puerto ${PORT}`);
});
