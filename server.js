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
    // ✅ Recibimos num_documento también según la documentación
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
    ) VALUES (
        $1, $2, $3,
        convert_to($4, 'UTF8'),
        CASE WHEN $5::text IS NOT NULL THEN convert_to($5::text, 'UTF8') ELSE NULL END,
        1
    )`,
    [nombre, email, passwordHasheada, rut, num_documento || null]
);
El fix es agregar ::text para que PostgreSQL sepa exactamente qué tipo esperar aunque llegue NULL.

Haz git push y prueba de nuevo.


Cla

        res.json({ message: "¡Cuenta creada con éxito! Registrado como Voluntario." });
    } catch (err) {
        console.error('❌ Error en /api/registro:', err.message);
        res.status(500).json({ error: err.message }); // ✅ Muestra el error real
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
        return res.status(400).json({ message: "Datos insuficientes" });
    }

    try {
        const resultado = await pool.query(
            `UPDATE usuarios 
             SET num_documento_encriptado = convert_to($1, 'UTF8'), tipo_usuario = 2 
             WHERE usuario_id = $2 RETURNING *`,
            [num_documento, id]
        );

        if (resultado.rows.length === 0) {
            return res.status(404).json({ message: "Usuario no encontrado" });
        }

        res.json({ message: "¡Validación aprobada! Ahora eres Organizador." });
    } catch (err) {
        console.error('❌ Error en /api/upgrade:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// CASO 3: CREAR EVENTO
app.post('/api/eventos', async (req, res) => {
    const { titulo, descripcion, tipo_evento, direccion, latitud, longitud, fecha_evento, creado_por } = req.body;

    if (!titulo || !descripcion || !latitud || !longitud || !creado_por) {
        return res.status(400).json({ message: "Faltan campos obligatorios" });
    }

    try {
        await pool.query(
            `INSERT INTO eventos (titulo, descripcion, tipo_evento, direccion, latitud, longitud, fecha_evento, creado_por)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [titulo, descripcion, tipo_evento, direccion, latitud, longitud, fecha_evento, creado_por]
        );
        res.json({ message: "¡Punto de voluntariado publicado con éxito!" });
    } catch (err) {
        console.error('❌ Error en /api/eventos POST:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// LEER EVENTOS
app.get('/api/eventos', async (req, res) => {
    try {
        const queryEventos = await pool.query('SELECT * FROM eventos');
        res.json(queryEventos.rows);
    } catch (err) {
        console.error('❌ Error en /api/eventos GET:', err.message);
        res.status(500).json({ error: err.message });
    }
});

app.listen(PORT, () => {
    console.log(`📡 Backend corriendo en: http://localhost:${PORT}`);
});
