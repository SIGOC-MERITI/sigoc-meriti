const express = require("express");
const cors = require("cors");
const sqlite3 = require("sqlite3").verbose();
const path = require("path");

const app = express();
const PORT = 3000;

app.use(cors());

// CONFIGURAÇÃO DE LIMITE PARA FOTOS (ESSENCIAL PARA O SIGOC)
// Aumentado para 50mb para suportar múltiplas fotos em alta resolução
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));

app.use(express.static("public"));

/* ================================
   BANCO DE DADOS
================================ */
const db = new sqlite3.Database("./database/db.sqlite", (err) => {
    if (err) console.error("Erro ao abrir banco:", err.message);
});

db.serialize(() => {
    /* TABELA USUÁRIOS */
    db.run(`
        CREATE TABLE IF NOT EXISTS usuarios (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            nome TEXT,
            usuario TEXT UNIQUE,
            senha TEXT,
            nivel TEXT,
            criado_por TEXT,
            data_criacao DATETIME DEFAULT CURRENT_TIMESTAMP,
            ativo INTEGER DEFAULT 1
        )
    `);

    /* TABELA LOGS */
    db.run(`
        CREATE TABLE IF NOT EXISTS logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            usuario TEXT,
            acao TEXT,
            data DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);

    /* TABELA OCORRÊNCIAS */
    db.run(`
        CREATE TABLE IF NOT EXISTS ocorrencias (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
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
            data_registro DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);

    /* TABELA VISTORIAS (ADICIONADA NO LOCAL CORRETO) */
    db.run(`
        CREATE TABLE IF NOT EXISTS vistorias (
            id INTEGER PRIMARY KEY AUTOINCREMENT,

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

    /* CRIAR ADMIN SE NÃO EXISTIR */
    db.run(`
        INSERT OR IGNORE INTO usuarios
        (nome,usuario,senha,nivel,criado_por)
        VALUES ('Administrador','admin','123456','master','sistema')
    `);
});

/* ================================
   FUNÇÃO DE LOG
================================ */
function registrarLog(usuario, acao) {
    db.run(
        "INSERT INTO logs (usuario,acao) VALUES (?,?)",
        [usuario, acao],
        (err) => { if (err) console.error("Erro log:", err.message); }
    );
}

/* ================================
   ROTAS DE LOGIN E USUÁRIOS
================================ */
app.post("/login", (req, res) => {
    const { usuario, senha } = req.body;
    db.get(
        "SELECT * FROM usuarios WHERE usuario=? AND senha=? AND ativo=1",
        [usuario, senha],
        (err, row) => {
            if (err) return res.status(500).json({ erro: "Erro no banco de dados" });
            if (!row) return res.status(401).json({ erro: "Usuário ou senha inválidos" });
            registrarLog(row.usuario, "Login no sistema");
            res.json({ usuario: row.usuario, nivel: row.nivel, nome: row.nome });
        }
    );
});

app.get("/usuarios", (req, res) => {
    db.all("SELECT id,nome,usuario,nivel,criado_por,data_criacao,ativo FROM usuarios", (err, rows) => {
        if (err) return res.status(500).json({ erro: "Erro ao buscar usuários" });
        res.json(rows);
    });
});

app.post("/usuarios", (req, res) => {
    const { nome, usuario, senha, nivel, criado_por } = req.body;
    db.run(
        "INSERT INTO usuarios (nome,usuario,senha,nivel,criado_por) VALUES (?,?,?,?,?)",
        [nome, usuario, senha, nivel, criado_por],
        function (err) {
            if (err) return res.status(500).json({ erro: "Erro ao criar usuário" });
            registrarLog(criado_por, "Criou usuário " + usuario);
            res.json({ sucesso: true, id: this.lastID });
        }
    );
});

app.delete("/usuarios/:id", (req, res) => {
    const id = req.params.id;
    db.get("SELECT usuario FROM usuarios WHERE id=?", [id], (err, row) => {
        if (!row) return res.status(404).json({ erro: "Usuário não encontrado" });
        if (row.usuario === "admin") return res.status(400).json({ erro: "Não é permitido excluir o admin" });
        db.run("DELETE FROM usuarios WHERE id=?", [id], function (err) {
            if (err) return res.status(500).json({ erro: "Erro ao remover usuário" });
            registrarLog("sistema", "Removeu usuário " + row.usuario);
            res.json({ sucesso: true });
        });
    });
});

/* ================================
   REGISTRAR OCORRÊNCIA (COM FOTOS)
================================ */
app.post("/ocorrencias", (req, res) => {
    const { data, equipe, tipo, quantidade, descricao, status, endereco, bairro, solicitante, cpf, usuario, fotos } = req.body;
    
    if (!tipo || !equipe) {
        return res.status(400).json({ erro: "Dados incompletos" });
    }

    db.run(
        `INSERT INTO ocorrencias (data,equipe,tipo,quantidade,descricao,status,endereco,bairro,solicitante,cpf,usuario,fotos) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
        [data, equipe, tipo, quantidade, descricao, status, endereco, bairro, solicitante, cpf, usuario, fotos],
        function (err) {
            if (err) {
                console.error("ERRO AO SALVAR OCORRÊNCIA:", err.message);
                return res.status(500).json({ erro: "Erro interno ao salvar. Verifique o tamanho das fotos." });
            }
            registrarLog(usuario, `Registrou ocorrência ${tipo} em ${bairro}`);
            res.json({ sucesso: true, id: this.lastID });
        }
    );
});

app.get("/ocorrencias", (req, res) => {
    db.all("SELECT * FROM ocorrencias ORDER BY id DESC", (err, rows) => {
        if (err) return res.status(500).json({ erro: "Erro ao buscar ocorrências" });
        res.json(rows);
    });
});

/* ================================
   NOVA ROTA VISTORIAS (ADICIONADA)
================================ */
app.post("/vistorias", (req, res) => {

    const v = req.body;

    db.run(
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
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
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
        ],
        function (err) {
            if (err) {
                console.error("ERRO AO SALVAR VISTORIA:", err.message);
                return res.status(500).json({ erro: "Erro ao salvar vistoria" });
            }
            registrarLog("sistema", "Registrou vistoria em " + v.vistoria.bairro);
            res.json({ sucesso: true, id: this.lastID });
        }
    );
});

/* ================================
   LOGS
================================ */
app.get("/logs", (req, res) => {
    db.all("SELECT * FROM logs ORDER BY data DESC", (err, rows) => {
        if (err) return res.status(500).json({ erro: "Erro ao buscar logs" });
        res.json(rows);
    });
});
app.get("/vistorias-lista", (req, res) => {
    db.all("SELECT * FROM vistorias ORDER BY id DESC", (err, rows) => {
        if (err) return res.status(500).json({ erro: "Erro ao buscar vistorias" });
        res.json(rows);
    });
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