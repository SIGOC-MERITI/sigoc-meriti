const express = require("express");
const cors = require("cors");
const { Pool } = require("pg");
const path = require("path");

const app = express();
const PORT = 3000;

app.use(cors());

// LIMITE DE UPLOAD
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));

app.use(express.static(path.join(__dirname, "public")));

/* ================================
   CONEXÃO COM SUPABASE
================================ */
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

pool.connect()
  .then(() => console.log("🔥 Conectado ao Supabase"))
  .catch(err => console.error("❌ Erro no banco:", err));


/* ================================
   CRIAR TABELAS (SE NÃO EXISTIREM)
================================ */
async function criarTabelas() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS usuarios (
      id SERIAL PRIMARY KEY,
      nome TEXT,
      usuario TEXT UNIQUE,
      senha TEXT,
      nivel TEXT,
      criado_por TEXT,
      data_criacao TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      ativo INTEGER DEFAULT 1
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS logs (
      id SERIAL PRIMARY KEY,
      usuario TEXT,
      acao TEXT,
      data TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS ocorrencias (
      id SERIAL PRIMARY KEY,
      data TEXT,
      equipe TEXT,
      tipo TEXT,
      quantidade INTEGER,
      descricao TEXT,
      status TEXT,
      endereco TEXT,
      bairro TEXT,
      solicitante TEXT,
      cpf TEXT,
      usuario TEXT,
      fotos TEXT,
      data_registro TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS vistorias (
      id SERIAL PRIMARY KEY,
      solicitante_nome TEXT,
      solicitante_cpf TEXT,
      solicitante_telefone TEXT,
      solicitante_email TEXT,
      solicitante_tipo TEXT,
      tipo TEXT,
      risco TEXT,
      endereco TEXT,
      bairro TEXT,
      referencia TEXT,
      descricao TEXT,
      responsavel TEXT,
      data TEXT
    )
  `);

  // CRIAR ADMIN
  await pool.query(`
    INSERT INTO usuarios (nome,usuario,senha,nivel,criado_por)
    VALUES ('Administrador','admin','123456','master','sistema')
    ON CONFLICT (usuario) DO NOTHING
  `);
}

criarTabelas();

/* ================================
   LOG
================================ */
async function registrarLog(usuario, acao) {
  try {
    await pool.query(
      "INSERT INTO logs (usuario,acao) VALUES ($1,$2)",
      [usuario, acao]
    );
  } catch (err) {
    console.error("Erro log:", err.message);
  }
}

/* ================================
   LOGIN
================================ */
app.post("/login", async (req, res) => {
  const { usuario, senha } = req.body;

  try {
    const result = await pool.query(
      "SELECT * FROM usuarios WHERE usuario=$1 AND senha=$2 AND ativo=1",
      [usuario, senha]
    );

    const row = result.rows[0];

    if (!row) {
      return res.status(401).json({ erro: "Usuário ou senha inválidos" });
    }

    await registrarLog(row.usuario, "Login no sistema");

    res.json({
      id: row.id,
      usuario: row.usuario,
      nivel: row.nivel,
      nome: row.nome,
      pode_retroativa: row.pode_retroativa
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: "Erro no banco de dados" });
  }
});

/* ================================
   USUÁRIOS
================================ */
app.get("/usuarios", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT id,nome,usuario,nivel,criado_por,data_criacao,ativo FROM usuarios ORDER BY id ASC"
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ erro: "Erro ao buscar usuários" });
  }
});

app.post("/usuarios", async (req, res) => {
  const { nome, usuario, senha, nivel, pode_retroativa, criado_por } = req.body;

  console.log("📥 RECEBIDO:", req.body);

  try {
    const result = await pool.query(
      `INSERT INTO usuarios (nome, usuario, senha, nivel, pode_retroativa, criado_por)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [nome, usuario, senha, nivel, pode_retroativa ?? false, criado_por]
    );

    console.log("✅ INSERIDO ID:", result.rows[0].id);

    await registrarLog(criado_por, "Criou usuário " + usuario);

    res.json({ sucesso: true, id: result.rows[0].id });

  } catch (err) {
    console.error("❌ ERRO AO INSERIR:", err);
    res.status(500).json({ erro: err.message });
  }
});

/* ================================
   EDITAR USUÁRIO
================================ */
app.put("/usuarios/:id", async (req, res) => {
  const id = req.params.id;
  const { nome, usuario, senha, nivel, alterado_por } = req.body;

  try {
    const usuarioAtual = await pool.query(
      "SELECT * FROM usuarios WHERE id=$1",
      [id]
    );

    if (!usuarioAtual.rows[0]) {
      return res.status(404).json({ erro: "Usuário não encontrado" });
    }

    const atual = usuarioAtual.rows[0];

    if (atual.usuario === "admin" && usuario && usuario !== "admin") {
      return res.status(400).json({ erro: "Não é permitido alterar o login do admin" });
    }

    const novoNome = nome ?? atual.nome;
    const novoUsuario = usuario ?? atual.usuario;
    const novaSenha = senha && senha.trim() !== "" ? senha : atual.senha;
    const novoNivel = nivel ?? atual.nivel;

    const result = await pool.query(
      `UPDATE usuarios
       SET nome=$1, usuario=$2, senha=$3, nivel=$4
       WHERE id=$5
       RETURNING id,nome,usuario,nivel`,
      [novoNome, novoUsuario, novaSenha, novoNivel, id]
    );

    await registrarLog(
      alterado_por || "sistema",
      "Editou usuário " + atual.usuario
    );

    res.json({
      sucesso: true,
      usuario: result.rows[0]
    });

  } catch (err) {
    console.error("❌ ERRO AO EDITAR:", err);
    res.status(500).json({ erro: err.message });
  }
});

app.delete("/usuarios/:id", async (req, res) => {
  const id = req.params.id;

  try {
    const user = await pool.query(
      "SELECT usuario FROM usuarios WHERE id=$1",
      [id]
    );

    if (!user.rows[0]) {
      return res.status(404).json({ erro: "Usuário não encontrado" });
    }

    if (user.rows[0].usuario === "admin") {
      return res.status(400).json({ erro: "Não é permitido excluir o admin" });
    }

    await pool.query("DELETE FROM usuarios WHERE id=$1", [id]);

    await registrarLog("sistema", "Removeu usuário " + user.rows[0].usuario);

    res.json({ sucesso: true });

  } catch (err) {
    res.status(500).json({ erro: "Erro ao remover usuário" });
  }
});

/* ================================
   OCORRÊNCIAS
================================ */
app.post("/ocorrencias", async (req, res) => {
  const {
    data,
    equipe,
    tipo,
    quantidade,
    descricao,
    status,
    endereco,
    bairro,
    solicitante,
    cpf,
    usuario,
    fotos,
    pode_retroativa
  } = req.body;

  if (!tipo || !equipe) {
    return res.status(400).json({ erro: "Dados incompletos" });
  }

  try {
    const dataAtualServidor = new Date().toLocaleDateString("pt-BR");

    const dataFinal =
      pode_retroativa === true && data
        ? data
        : dataAtualServidor;

    const result = await pool.query(
      `INSERT INTO ocorrencias 
      (data, equipe, tipo, quantidade, descricao, status, endereco, bairro, solicitante, cpf, usuario, fotos) 
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
      [
        dataFinal,
        equipe,
        tipo,
        quantidade,
        descricao,
        status,
        endereco,
        bairro,
        solicitante,
        cpf,
        usuario,
        fotos
      ]
    );

    const textoLog =
      pode_retroativa === true && data
        ? `Registrou ocorrência retroativa ${tipo} em ${bairro}`
        : `Registrou ocorrência ${tipo} em ${bairro}`;

    await registrarLog(usuario, textoLog);

    res.json({ sucesso: true, id: result.rows[0].id });

  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: "Erro ao salvar ocorrência" });
  }
});

app.get("/ocorrencias", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT * FROM ocorrencias ORDER BY id DESC"
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: "Erro ao buscar ocorrências" });
  }
});

/* ================================
   VISTORIAS
================================ */
app.post("/vistorias", async (req, res) => {
  const v = req.body;

  try {
    const result = await pool.query(
      `INSERT INTO vistorias (
        solicitante_nome,
        solicitante_cpf,
        solicitante_telefone,
        solicitante_email,
        solicitante_tipo,
        tipo,
        risco,
        endereco,
        bairro,
        referencia,
        descricao,
        responsavel,
        data
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id`,
      [
        v.solicitante.nome,
        v.solicitante.cpf,
        v.solicitante.telefone,
        v.solicitante.email,
        v.solicitante.tipo,
        v.vistoria.tipo,
        v.vistoria.risco,
        v.vistoria.endereco,
        v.vistoria.bairro,
        v.vistoria.referencia,
        v.vistoria.descricao,
        v.vistoria.responsavel,
        v.vistoria.data
      ]
    );

    await registrarLog("sistema", "Registrou vistoria em " + v.vistoria.bairro);

    res.json({ sucesso: true, id: result.rows[0].id });

  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: "Erro ao salvar vistoria" });
  }
});

app.get("/vistorias-lista", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT * FROM vistorias ORDER BY id DESC"
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ erro: "Erro ao buscar vistorias" });
  }
});

/* ================================
   LOGS
================================ */
app.get("/logs", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT * FROM logs ORDER BY data DESC"
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ erro: "Erro ao buscar logs" });
  }
});

/* ================================
   SERVIDOR
================================ */
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "login.html"));
});

module.exports = app;