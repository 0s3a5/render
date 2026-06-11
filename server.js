const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');

const app = express();

// --- MIDDLEWARES ---
// Permitir que tu app de Android (u otras fuentes) se conecte sin bloqueos de CORS
app.use(cors());
// Habilitar al servidor para recibir y procesar datos en formato JSON
app.use(express.json()); 

// --- CONFIGURACIÓN DE NEON TECH (POSTGRESQL) ---
const pool = new Pool({
  connectionString: "postgresql://neondb_owner:npg_UvGCiLH8fBZ9@ep-restless-wildflower-aqs0lfl4-pooler.c-8.us-east-1.aws.neon.tech/neondb?sslmode=require",
});

// Probamos la conexión inicial con Neon al encender el backend
pool.connect((err, client, release) => {
  if (err) {
    return console.error('❌ Error de conexión con Neon Tech:', err.stack);
  }
  console.log('🔌 Conexión exitosa y segura establecida con Neon Tech');
  release();
});

// =======================================================================
// 📍 RUTA 1 [GET]: OBTENER EVENTOS (Para pintar los pines en tu Mapa de Android)
// =======================================================================
app.get('/api/eventos', async (req, res) => {
  try {
    // Consulta limpia a la tabla de voluntariados
    const result = await pool.query('SELECT * FROM voluntariados;');
    
    // El backend le responde a Android enviándole la lista en un JSON limpio
    res.json(result.rows); 
  } catch (err) {
    console.error("Error en el GET de Neon:", err.message);
    res.status(500).json({ error: 'Error al obtener los eventos de la base de datos' });
  }
});
// Ruta de Login en server.js
app.post('/api/login', async (req, res) => {
    const { email, password } = req.body;

    try {
        // Buscamos el usuario por su email en Neon Tech
        // ⚠️ Revisa si tu columna se llama 'email' y 'password' (o 'contrasena')
        const result = await pool.query(
            'SELECT usuario_id, username, email, tipo_usuario, password FROM usuarios WHERE email = $1', 
            [email]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ message: "El usuario no existe" });
        }

        const usuario = result.rows[0];

        // Verificación de contraseña (texto plano para tu prueba actual)
        if (usuario.password !== password) {
            return res.status(401).json({ message: "Contraseña incorrecta" });
        }

        // Si todo está bien, respondemos sus datos y su ROL (tipo_usuario)
        res.json({
            message: "Login exitoso",
            usuario: {
                usuario_id: usuario.usuario_id,
                username: usuario.username,
                email: usuario.email,
                tipo_usuario: usuario.tipo_usuario // Aquí va el 1, 2 o 3
            }
        });

    } catch (err) {
        console.error(err.message);
        res.status(500).json({ error: "Error en el servidor al intentar loguear" });
    }
});
// =======================================================================
// 📝 RUTA 2 [POST]: CREAR EVENTO (Para guardar un nuevo pin desde la App)
// =======================================================================
app.post('/api/eventos', async (req, res) => {
  // Desestructuramos los campos exactos que enviará tu app de Android en formato JSON
  const { titulo, descripcion, tipo_evento, direccion, latitud, longitud, creado_por } = req.body;

  // Validación básica por seguridad
  if (!titulo || !latitud || !longitud) {
    return res.status(400).json({ error: 'Faltan campos obligatorios (titulo, latitud o longitud)' });
  }

  try {
    // Inserción parametrizada estándar para evitar inyecciones SQL nocivas
    const query = `
      INSERT INTO voluntariados (titulo, descripcion, tipo_evento, direccion, latitud, longitud, creado_por) 
      VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *;
    `;
    const values = [titulo, descripcion, tipo_evento, direccion, latitud, longitud, creado_por];
    
    const result = await pool.query(query, values);
    
    // Respondemos a Android que se guardó correctamente y le devolvemos el objeto creado
    res.status(201).json({ 
      message: '¡Evento de voluntariado registrado con éxito!', 
      evento: result.rows[0] 
    });
  } catch (err) {
    console.error("Error en el POST de Neon:", err.message);
    res.status(500).json({ error: 'No se pudo registrar el evento en la base de datos' });
  }
});
// Ruta para registrar nuevos usuarios en server.js
app.post('/api/registro', async (req, res) => {
    const { username, email, password } = req.body;

    try {
        // 1. Validamos que el correo no esté registrado previamente
        const validarEmail = await pool.query('SELECT * FROM usuarios WHERE email = $1', [email]);
        if (validarEmail.rows.length > 0) {
            return res.status(400).json({ message: "El correo electrónico ya está en uso" });
        }

        // 2. Insertamos el nuevo registro
        // 🚨 IMPORTANTE: Definimos tipo_usuario = 1 por defecto (Usuario normal sin permisos de subida)
        await pool.query(
            'INSERT INTO usuarios (username, email, password, tipo_usuario) VALUES ($1, $2, $3, 1)',
            [username, email, password]
        );

        res.json({ message: "¡Cuenta creada con éxito! Ya puedes iniciar sesión." });

    } catch (err) {
        console.error(err.message);
        res.status(500).json({ error: "Error interno del servidor al crear la cuenta" });
    }
});
// =======================================================================
// 🚀 CONFIGURACIÓN DEL PUERTO (Dinámico para Render / 10000 para Local)
// =======================================================================
const PORT = process.env.PORT || 10000; 

app.listen(PORT, () => {
  console.log(`🚀 Servidor backend corriendo con éxito en el puerto ${PORT}`);
});
