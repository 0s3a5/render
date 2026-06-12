const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

// ==========================================================
// ⚙️ MIDDLEWARES DE INFRAESTRUCTURA
// ==========================================================
app.use(cors()); // Permite conexiones desde el emulador o teléfonos reales
app.use(express.json()); // 🚨 CRÍTICO: Permite que Node.js lea los cuerpos JSON enviados desde Android

// ==========================================================
// 🗄️ ENLACE DIRECTO A NEON TECH (PostgreSQL)
// ==========================================================
// ⚠️ REVISA: Reemplaza esta URL con la cadena de conexión real de tu panel de Neon
const connectionString = process.env.DATABASE_URL || 'postgresql://usuario:password@identificador-neon.aws.neon.tech/neondb?sslmode=require';

const pool = new Pool({
    connectionString: connectionString,
});

// Comprobar estado de salud de la base de datos al encender el servidor
pool.query('SELECT NOW()', (err, res) => {
    if (err) {
        console.error('❌ Error crítico al conectar con Neon Tech:', err.message);
    } else {
        console.log('🚀 Conexión establecida de forma exitosa con Neon Tech:', res.rows[0].now);
    }
});

// ==========================================================
// 📝 CASO 1: ENDPOINT DE REGISTRO SIMPLIFICADO
// ==========================================================
app.post('/api/registro', async (req, res) => {
    const { nombre, email, password, rut } = req.body; 

    if (!nombre || !email || !password || !rut) {
        return res.status(400).json({ message: "Todos los campos son obligatorios" });
    }

    try {
        // Verificar disponibilidad de correo
        const validarEmail = await pool.query('SELECT * FROM usuarios WHERE email = $1', [email]);
        if (validarEmail.rows.length > 0) {
            return res.status(400).json({ message: "El correo electrónico ya está registrado" });
        }

        // Mapeo adaptado a tu esquema:
        // - 'usuario_id' se autogenera mediante DEFAULT gen_random_uuid().
        // - 'rut' se escapa para que sea compatible con la columna BYTEA (rut_encriptado).
        // - 'num_documento_encriptado' entra vacío (NULL) hasta que soliciten el upgrade.
        // - 'tipo_usuario' es 1 por defecto (Voluntario).
        await pool.query(
            `INSERT INTO usuarios (
                nombre, 
                email, 
                password_hash, 
                rut_encriptado, 
                num_documento_encriptado, 
                tipo_usuario
            ) VALUES ($1, $2, $3, decode($4, 'escape'), NULL, 1)`,
            [nombre, email, password, rut]
        );

        res.json({ message: "¡Cuenta creada con éxito! Registrado como Voluntario." });
    } catch (err) {
        console.error('❌ Error en /api/registro:', err.message);
        res.status(500).json({ error: "Error en el servidor al procesar el registro" });
    }
});

// ==========================================================
// 🔑 CASO 2: ENDPOINT DE LOGIN
// ==========================================================
app.post('/api/login', async (req, res) => {
    const { email, password } = req.body;

    if (!email || !password) {
        return res.status(400).json({ message: "Correo y contraseña requeridos" });
    }

    try {
        // Comparamos el login usando la columna 'password_hash' de tu imagen
        const usuarioQuery = await pool.query(
            'SELECT usuario_id, nombre, email, tipo_usuario FROM usuarios WHERE email = $1 AND password_hash = $2', 
            [email, password]
        );

        if (usuarioQuery.rows.length === 0) {
            return res.status(401).json({ message: "Credenciales incorrectas" });
        }

        const usuario = usuarioQuery.rows[0];

        // Respondemos con la estructura exacta que tu App Android (UsuarioData) necesita leer
        res.json({
            message: "Ingreso exitoso",
            usuario: {
                id: usuario.usuario_id, // Convertimos tu 'usuario_id' al parámetro 'id' de Android
                nombre: usuario.nombre,
                email: usuario.email,
                tipo_usuario: usuario.tipo_usuario || 1 // Resguardo si viene nulo
            }
        });
    } catch (err) {
        console.error('❌ Error en /api/login:', err.message);
        res.status(500).json({ error: "Error interno del servidor en el login" });
    }
});

// ==========================================================
// 🚀 ENDPOINT DE ASCENSO POSTERIOR (Upgrade a Organizador)
// ==========================================================
app.post('/api/upgrade', async (req, res) => {
    const { id, num_documento } = req.body; // Recibe el id (usuario_id) y el documento de identidad

    if (!id || !num_documento) {
        return res.status(400).json({ message: "Datos insuficientes para el ascenso" });
    }

    try {
        // Guardamos el documento como escape binario en 'num_documento_encriptado' y cambiamos tipo_usuario a 2
        const resultado = await pool.query(
            `UPDATE usuarios 
             SET num_documento_encriptado = decode($1, 'escape'), tipo_usuario = 2 
             WHERE usuario_id = $2 RETURNING *`,
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
        // Registra el pin guardando el UUID del organizador (creado_por) apuntando a 'usuario_id'
        await pool.query(
            `INSERT INTO eventos (
                titulo, descripcion, tipo_evento, direccion, latitud, longitud, fecha_evento, creado_por
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [titulo, descripcion, tipo_evento, direccion, latitud, longitud, fecha_evento, creado_por]
        );

        res.json({ message: "¡Punto de voluntariado publicado con éxito en el mapa!" });
    } catch (err) {
        console.error('❌ Error en /api/eventos (POST):', err.message);
        res.status(500).json({ error: "Error al registrar el punto en el mapa" });
    }
});

// ==========================================================
// 📡 ENDPOINT EXTRA: LEER EVENTOS (Para pintar el mapa de Android)
// ==========================================================
app.get('/api/eventos', async (req, res) => {
    try {
        const queryEventos = await pool.query('SELECT * FROM eventos');
        res.json(queryEventos.rows); // Envía la lista de pines a la aplicación
    } catch (err) {
        console.error('❌ Error en /api/eventos (GET):', err.message);
        res.status(500).json({ error: "Error al leer puntos desde Neon Tech" });
    }
});

// ==========================================================
// 🏁 INICIO DEL SERVIDOR
// ==========================================================
app.listen(PORT, () => {
    console.log(`\n=================================================`);
    console.log(`📡 Backend corriendo y listo en: http://localhost:${PORT}`);
    console.log(`=================================================\n`);
});
