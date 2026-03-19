router.post("/login", async (req, res) => {
  try {
    const { usuario, senha } = req.body;

    console.log("BODY:", req.body);

    const { data, error } = await supabase
      .from("usuarios")
      .select("*")
      .eq("usuario", usuario);

    console.log("RESULTADO DO BANCO:", data);

    if (!data || data.length === 0) {
      return res.status(401).json({ erro: "Usuário não encontrado" });
    }

    const user = data[0];

    // ⚠️ COMPARAÇÃO SEM BCRYPT (TESTE)
    if (senha !== user.senha) {
      return res.status(401).json({ erro: "Senha incorreta" });
    }

    return res.json({
      mensagem: "Login OK",
      usuario: user
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: "Erro no servidor" });
  }
});