const express = require('express');
const { Pool } = require('pg');
const crypto = require('crypto');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

// ==========================================================
// ⚙️ MIDDLEWARES INFRAESTRUCTURA
// ==========================================================
app.use(cors()); // Permite conexiones desde el emulador o celulares reales
app.use(express.json()); // 🚨 CRÍTICO: Permite que Node.js lea los archivos JSON enviados desde Android

// ==========================================================
// 🗄️ CONFIGURACIÓN DE ENLACE A NEON TECH (PostgreSQL)
// ==========================================================
// Reemplaza los datos dentro de la URL con tus credenciales reales de Neon Tech
const connectionString = process.env.DATABASE_URL || 'postgresql://usuario:password@identificador-neon.aws.neon.tech/neondb?sslmode=require';

const pool = new Pool({
    connectionString: connectionString,
});

// Verificar conexión inicial con Neon Tech
pool.query('SELECT NOW()', (err, res) => {
    if (err) {
        console.error('❌ Error crítico al conectar con Neon Tech:', err.message);
    } else {
        console.log('🚀 Conexión exitosa a la Base de Datos Neon Tech:', res.rows[0].now);
    }
});

// ==========================================================
// 📝 CASO 1: ENDPOINT DE REGISTRO (Simplificado, sin documento)
// ==========================================================
app.post('/api/registro', async (req, res) => {
    const { nombre, email, password, rut } = req.body;

    // Validación simple en servidor
    if (!nombre || !email || !password || !rut) {
        return res.status(400).json({ message: "Todos los campos son obligatorios" });
    }

    try {
        // Verificar si el correo ya existe
        const validarEmail = await pool.query('SELECT * FROM usuarios WHERE email = $1', [email]);
        if (validarEmail.rows.length > 0) {
            return res.status(400).json({ message: "El correo electrónico ya está registrado" });
        }

        // Generamos un UUID único universal v4 para el nuevo usuario
        const nuevoId = crypto.randomUUID();

        // Guardamos en Neon Tech: num_documento entra como NULL, tipo_usuario = 1 (Voluntario)
        await pool.query(
            'INSERT INTO usuarios (id, nombre, email, password, rut, num_documento, tipo_usuario) VALUES ($1, $2, $3, $4, $5, NULL, 1)',
            [nuevoId, nombre, email, password, rut]
        );

        res.json({ message: "¡Cuenta creada con éxito! Entraste como Voluntario." });
    } catch (err) {
        console.error('❌ Error en /api/registro:', err.message);
        res.status(500).json({ error: "Error en el servidor al procesar el registro" });
    }
});

// ==========================================================
// 🔑 CASO 2: ENDPOINT DE LOGIN (Retorna el UUID y el rol activo)
// ==========================================================
app.post('/api/login', async (req, res) => {
    const { email, password } = req.body;

    if (!email || !password) {
        return res.status(400).json({ message: "Correo y contraseña requeridos" });
    }

    try {
        const usuarioQuery = await pool.query('SELECT * FROM usuarios WHERE email = $1 AND password = $2', [email, password]);

        if (usuarioQuery.rows.length === 0) {
            return res.status(401).json({ message: "Credenciales incorrectas" });
        }

        const usuario = usuarioQuery.rows[0];

        // Respondemos mandándole el objeto idéntico al 'UsuarioData' de Android
        res.json({
            message: "Ingreso exitoso",
            usuario: {
                id: usuario.id,               // UUID guardado en base
                nombre: usuario.nombre,
                email: usuario.email,
                tipo_usuario: usuario.tipo_usuario // 1: Voluntario, 2: Organizador
            }
        });
    } catch (err) {
        console.error('❌ Error en /api/login:', err.message);
        res.status(500).json({ error: "Error interno del servidor en el login" });
    }
});

// ==========================================================
// 🚀 NUEVO ENDPOINT: ASCENSO A ORGANIZADOR (Upgrade posterior)
// ==========================================================
app.post('/api/upgrade', async (req, res) => {
    const { id, num_documento } = req.body; // Recibe el UUID del usuario y el número de documento

    if (!id || !num_documento) {
        return res.status(400).json({ message: "Datos insuficientes para el ascenso" });
    }

    try {
        // Buscamos al usuario por su UUID, inyectamos su documento y subimos su rol a 2
        const resultado = await pool.query(
            'UPDATE usuarios SET num_documento = $1, tipo_usuario = 2 WHERE id = $2 RETURNING *',
            [num_documento, id]
        );

        if (resultado.rows.length === 0) {
            return res.status(404).json({ message: "El usuario no existe en el sistema" });
        }

        res.json({ message: "¡Validación aprobada! Ahora eres Organizador de eventos." });
    } catch (err) {
        console.error('❌ Error en /api/upgrade:', err.message);
        res.status(500).json({ error: "Error de servidor al validar el número de documento" });
    }
});

// ==========================================================
// 🗺️ CASO 3: ENDPOINT PARA CREAR PUNTO DE VOLUNTARIADO
// ==========================================================
app.post('/api/eventos', async (req, res) => {
    const { titulo, descripcion, tipo_evento, direccion, latitud, longitud, fecha_evento, creado_por } = req.body;

    try {
        // Insertamos el punto vinculándolo dinámicamente con el UUID de quien inició sesión (creado_por)
        await pool.query(
            'INSERT INTO eventos (titulo, descripcion, tipo_evento, direccion, latitud, longitud, fecha_evento, creado_por) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
            [titulo, descripcion, tipo_evento, direccion, latitud, longitud, fecha_evento, creado_por]
        );

        res.json({ message: "¡Punto de voluntariado publicado con éxito en el mapa!" });
    } catch (err) {
        console.error('❌ Error en /api/eventos (POST):', err.message);
        res.status(500).json({ error: "Error al registrar el punto en el mapa" });
    }
});

// ==========================================================
// 📡 ENDPOINT EXTRA: OBTENER TODOS LOS EVENTOS (Para pintar el mapa)
// ==========================================================
app.get('/api/eventos', async (req, res) => {
    try {
        const queryEventos = await pool.query('SELECT * FROM eventos');
        res.json(queryEventos.rows); // Retorna el arreglo de pines a Android
    } catch (err) {
        console.error('❌ Error en /api/eventos (GET):', err.message);
        res.status(500).json({ error: "Error al leer puntos desde Neon Tech" });
    }
});

// ==========================================================
// 🏁 INICIO DEL SERVIDOR
// ==========================================================
app.listen(PORT, () => {
    console.log(`\n==============================================`);
    console.log(`📡 Servidor ejecutándose en: http://localhost:${PORT}`);
    console.log(`==============================================\n`);
});
