const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const app = express();

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));

// ─── Configurações ───────────────────────────────────────────────
const CONFIG_PATH = path.join(__dirname, 'data', 'config.json');

function readConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  } catch {
    return {};
  }
}

function saveConfig(cfg) {
  fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2));
}

// ─── Autenticação Admin ──────────────────────────────────────────
const ADMIN_USER = process.env.ADMIN_USER || 'garciaST';
const ADMIN_PASS_HASH = crypto
  .createHash('sha256')
  .update(process.env.ADMIN_PASS || 'Lu!131020')
  .digest('hex');

const sessions = new Map();

function makeToken() {
  return crypto.randomBytes(32).toString('hex');
}

function authMiddleware(req, res, next) {
  const token = req.headers['x-admin-token'] || req.query.token;
  if (token && sessions.has(token)) {
    next();
  } else {
    res.status(401).json({ error: 'Não autorizado' });
  }
}

// ─── Rotas Admin ─────────────────────────────────────────────────
app.post('/admin/login', (req, res) => {
  const { usuario, senha } = req.body;
  const senhaHash = crypto.createHash('sha256').update(senha || '').digest('hex');
  if (usuario === ADMIN_USER && senhaHash === ADMIN_PASS_HASH) {
    const token = makeToken();
    sessions.set(token, { user: usuario, at: Date.now() });
    res.json({ ok: true, token });
  } else {
    res.status(401).json({ error: 'Usuário ou senha incorretos' });
  }
});

app.post('/admin/logout', authMiddleware, (req, res) => {
  const token = req.headers['x-admin-token'];
  sessions.delete(token);
  res.json({ ok: true });
});

app.get('/admin/config', authMiddleware, (req, res) => {
  const cfg = readConfig();
  // Nunca expor SK completa — mascarar
  if (cfg.pagamento?.sk) {
    cfg.pagamento.sk_masked = cfg.pagamento.sk.slice(0, 10) + '••••••••••••••••';
    delete cfg.pagamento.sk;
  }
  res.json(cfg);
});

app.post('/admin/config', authMiddleware, (req, res) => {
  const cfg = readConfig();
  const body = req.body;

  // Campanha
  if (body.campanha) {
    cfg.campanha = { ...cfg.campanha, ...body.campanha };
  }
  // Pagamento — só atualiza SK se vier preenchida (não mascarada)
  if (body.pagamento) {
    if (body.pagamento.pk) cfg.pagamento.pk = body.pagamento.pk;
    if (body.pagamento.sk && !body.pagamento.sk.includes('•')) {
      cfg.pagamento.sk = body.pagamento.sk;
    }
  }
  // Marketing
  if (body.marketing) {
    cfg.marketing = { ...cfg.marketing, ...body.marketing };
  }

  saveConfig(cfg);
  res.json({ ok: true });
});

// Config pública (sem credenciais sensíveis) — usada pelo site
app.get('/config-publica', (req, res) => {
  const cfg = readConfig();
  res.json({
    campanha: cfg.campanha || {},
    marketing: cfg.marketing || {}
  });
});

// ─── Rota Pix ────────────────────────────────────────────────────
app.post('/criar-cobranca', async (req, res) => {
  try {
    const { amountCents, donorName } = req.body;
    if (!amountCents || amountCents < 100)
      return res.status(400).json({ error: 'Valor mínimo: R$ 1,00' });

    const cfg = readConfig();
    const PK = cfg.pagamento?.pk || process.env.PAYMENT_PK;
    const SK = cfg.pagamento?.sk || process.env.PAYMENT_SK;

    if (!PK || !SK) return res.status(500).json({ error: 'Credenciais de pagamento não configuradas' });

    const creds = Buffer.from(`${PK}:${SK}`).toString('base64');

    const response = await fetch('https://app.xflowpayments.com/api/v1/charges', {
      method: 'POST',
      headers: { 'Authorization': `Basic ${creds}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        amountCents,
        description: `Doação — ${cfg.campanha?.nome || 'Campanha'}`,
        customer: {
          name: donorName || 'Doador Anônimo',
          email: 'doador@vakinha.com.br',
          document: '00000000000'
        },
        external_reference: `ester-${Date.now()}`
      })
    });

    const data = await response.json();
    if (!response.ok) return res.status(response.status).json({ error: data.message || 'Erro na API' });

    res.json({
      id: data.id,
      qrCodeBase64: data.pix?.qrCodeBase64,
      copyPaste: data.pix?.copyPaste
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// ─── Painel Admin (HTML) ─────────────────────────────────────────
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// ─── Site principal ───────────────────────────────────────────────
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/health', (req, res) => res.json({ status: 'ok' }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Servidor rodando na porta ${PORT}`));
