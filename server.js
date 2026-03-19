const express = require("express");
const cors = require("cors");
const { Pool } = require("pg");
const path = require("path");

const app = express();
const PORT = 3000;

app.use(cors());

// CONFIGURAÇÃO DE LIMITE PARA FOTOS (ESSENCIAL PARA O SIGOC)
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));

app.use(express.static("public"));

/* ================================
   BANCO DE DADOS (SUPABASE)
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
   FUNÇÃO DE LOG
================================ */
async function registrarLog(usuario, acao) {
    try {
        await pool.query(
            "INSERT INTO logs (usuario, acao) VALUES ($1, $2)",
            [usuario, acao]
        );
    } catch (err) {
        console.error("Erro log:", err.message);
    }
}

/* ================================
   ROTAS DE LOGIN E USUÁRIOS
================================ */
app.post("/login", async (req, res) => {
    const { usuario, senha } = req.body;

    try {
        const result = await pool.query(
            "SELECT * FROM usuarios WHERE usuario=$1 AND senha=$2 AND ativo=1",
            [usuario, senha]
        );

        if (result.rows.length === 0) {
            return res.status(401).json({ erro: "Usuário ou senha inválidos" });
        }

        const row = result.rows[0];

        await registrarLog(row.usuario, "Login no sistema");

        res.json({
            usuario: row.usuario,
            nivel: row.nivel,
            nome: row.nome
        });

    } catch (err) {
        console.error(err);
        res.status(500).json({ erro: "Erro no banco de dados" });
    }
});

app.get("/usuarios", async (req, res) => {
    try {
        const result = await pool.query(
            "SELECT id,nome,usuario,nivel,criado_por,data_criacao,ativo FROM usuarios"
        );
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ erro: "Erro ao buscar usuários" });
    }
});

app.post("/usuarios", async (req, res) => {
    const { nome, usuario, senha, nivel, criado_por } = req.body;

    try {
        const result = await pool.query(
            "INSERT INTO usuarios (nome,usuario,senha,nivel,criado_por) VALUES ($1,$2,$3,$4,$5) RETURNING id",
            [nome, usuario, senha, nivel, criado_por]
        );

        await registrarLog(criado_por, "Criou usuário " + usuario);

        res.json({ sucesso: true, id: result.rows[0].id });

    } catch (err) {
        res.status(500).json({ erro: "Erro ao criar usuário" });
    }
});

app.delete("/usuarios/:id", async (req, res) => {
    const id = req.params.id;

    try {
        const result = await pool.query("SELECT usuario FROM usuarios WHERE id=$1", [id]);

        if (result.rows.length === 0) {
            return res.status(404).json({ erro: "Usuário não encontrado" });
        }

        const usuario = result.rows[0].usuario;

        if (usuario === "admin") {
            return res.status(400).json({ erro: "Não é permitido excluir o admin" });
        }

        await pool.query("DELETE FROM usuarios WHERE id=$1", [id]);

        await registrarLog("sistema", "Removeu usuário " + usuario);

        res.json({ sucesso: true });

    } catch (err) {
        res.status(500).json({ erro: "Erro ao remover usuário" });
    }
});

/* ================================
   REGISTRAR OCORRÊNCIA
================================ */
app.post("/ocorrencias", async (req, res) => {
    const { data, equipe, tipo, quantidade, descricao, status, endereco, bairro, solicitante, cpf, usuario, fotos } = req.body;

    if (!tipo || !equipe) {
        return res.status(400).json({ erro: "Dados incompletos" });
    }

    try {
        const result = await pool.query(
            `INSERT INTO ocorrencias 
            (data,equipe,tipo,quantidade,descricao,status,endereco,bairro,solicitante,cpf,usuario,fotos) 
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
            [data, equipe, tipo, quantidade, descricao, status, endereco, bairro, solicitante, cpf, usuario, fotos]
        );

        await registrarLog(usuario, `Registrou ocorrência ${tipo} em ${bairro}`);

        res.json({ sucesso: true, id: result.rows[0].id });

    } catch (err) {
        console.error("ERRO:", err.message);
        res.status(500).json({ erro: "Erro interno ao salvar." });
    }
});

app.get("/ocorrencias", async (req, res) => {
    try {
        const result = await pool.query("SELECT * FROM ocorrencias ORDER BY id DESC");
        res.json(result.rows);
    } catch (err) {
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
        console.error("ERRO:", err.message);
        res.status(500).json({ erro: "Erro ao salvar vistoria" });
    }
});

/* ================================
   LOGS
================================ */
app.get("/logs", async (req, res) => {
    try {
        const result = await pool.query("SELECT * FROM logs ORDER BY data DESC");
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ erro: "Erro ao buscar logs" });
    }
});

app.get("/vistorias-lista", async (req, res) => {
    try {
        const result = await pool.query("SELECT * FROM vistorias ORDER BY id DESC");
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ erro: "Erro ao buscar vistorias" });
    }
});

/* ================================
   INICIAR SERVIDOR
================================ */
app.get("/", (req, res) => {
  res.sendFile(__dirname + "/public/login.html");
});

app.listen(PORT, () => {
    console.log(`\x1b[32m%s\x1b[0m`, `SIGOC rodando com sucesso em http://localhost:${PORT}`);
    console.log(`Limites de upload: JSON: 50mb | URL Encoded: 50mb`);
});