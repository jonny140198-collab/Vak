const express = require('express');
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');
const mongoose = require('mongoose');
const app = express();

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));

// ─── Schema MongoDB ───────────────────────────────────────────────
const configSchema = new mongoose.Schema({
  _id: { type: String, default: 'main' },
  campanha: {
    nome:      { type: String, default: 'Ajude a Pequena Ester' },
    descricao: { type: String, default: 'Ester tem leucemia e precisa de tratamento urgente.' },
    meta:      { type: Number, default: 140000 },
    chavePix:  { type: String, default: '' },
    fotoUrl:   { type: String, default: '' }
  },
  pagamento: {
    pk: { type: String, default: '' },
    sk: { type: String, default: '' }
  },
  marketing: {
    pixelFacebook:  { type: String, default: '' },
    googleAnalytics: { type: String, default: '' }
  }
}, { versionKey: false });

const ConfigModel = mongoose.model('Config', configSchema);

// ─── Config em memória (fallback + cache) ────────────────────────
let CONFIG = {
  campanha: {
    nome: process.env.CAMP_NOME || 'Ajude a Pequena Ester',
    descricao: process.env.CAMP_DESC || 'Ester tem leucemia e precisa de tratamento urgente.',
    meta: parseFloat(process.env.CAMP_META) || 140000,
    chavePix: process.env.CAMP_PIX || '',
    fotoUrl: process.env.CAMP_FOTO || ''
  },
  pagamento: {
    pk: process.env.PAYMENT_PK || '',
    sk: process.env.PAYMENT_SK || ''
  },
  marketing: {
    pixelFacebook: process.env.PIXEL_FB || '',
    googleAnalytics: process.env.GA_ID || ''
  }
};

// ─── Conexão MongoDB ─────────────────────────────────────────────
let dbConectado = false;

async function conectarMongo() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.log('⚠️  MONGODB_URI não definida — usando config em memória');
    return;
  }
  try {
    await mongoose.connect(uri, { serverSelectionTimeoutMS: 5000 });
    dbConectado = true;
    console.log('✅ MongoDB conectado');

    // Carrega config salva no banco (ou cria com valores padrão)
    let doc = await ConfigModel.findById('main');
    if (!doc) {
      doc = await ConfigModel.create({ _id: 'main', ...CONFIG });
      console.log('📄 Config inicial criada no MongoDB');
    } else {
      // Mescla: banco prevalece, mas env vars de pagamento têm prioridade se banco estiver vazio
      CONFIG.campanha  = { ...CONFIG.campanha,  ...doc.campanha.toObject()  };
      CONFIG.marketing = { ...CONFIG.marketing, ...doc.marketing.toObject() };
      if (doc.pagamento.pk) CONFIG.pagamento.pk = doc.pagamento.pk;
      if (doc.pagamento.sk) CONFIG.pagamento.sk = doc.pagamento.sk;
      console.log('📄 Config carregada do MongoDB');
    }
  } catch (err) {
    console.error('❌ Erro ao conectar MongoDB:', err.message);
    console.log('⚠️  Continuando com config em memória');
  }
}

async function salvarConfigNoBanco() {
  if (!dbConectado) return;
  try {
    await ConfigModel.findByIdAndUpdate(
      'main',
      { $set: { campanha: CONFIG.campanha, pagamento: CONFIG.pagamento, marketing: CONFIG.marketing } },
      { upsert: true, new: true }
    );
  } catch (err) {
    console.error('❌ Erro ao salvar config no MongoDB:', err.message);
  }
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
  if (token && sessions.has(token)) return next();
  res.status(401).json({ error: 'Não autorizado' });
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
  sessions.delete(req.headers['x-admin-token']);
  res.json({ ok: true });
});

app.get('/admin/config', authMiddleware, (req, res) => {
  const cfg = JSON.parse(JSON.stringify(CONFIG));
  if (cfg.pagamento?.sk) {
    cfg.pagamento.sk_masked = cfg.pagamento.sk.slice(0, 10) + '••••••••••••••••';
    delete cfg.pagamento.sk;
  }
  cfg._db = dbConectado;
  res.json(cfg);
});

app.post('/admin/config', authMiddleware, async (req, res) => {
  const body = req.body;
  if (body.campanha) CONFIG.campanha = { ...CONFIG.campanha, ...body.campanha };
  if (body.pagamento) {
    if (body.pagamento.pk) CONFIG.pagamento.pk = body.pagamento.pk;
    if (body.pagamento.sk && !body.pagamento.sk.includes('•')) {
      CONFIG.pagamento.sk = body.pagamento.sk;
    }
  }
  if (body.marketing) CONFIG.marketing = { ...CONFIG.marketing, ...body.marketing };

  await salvarConfigNoBanco();
  res.json({ ok: true, persistido: dbConectado });
});

// Config pública (sem credenciais)
app.get('/config-publica', (req, res) => {
  res.json({ campanha: CONFIG.campanha, marketing: CONFIG.marketing });
});

// ─── Rota Pix ────────────────────────────────────────────────────
app.post('/criar-cobranca', async (req, res) => {
  try {
    const { amountCents, donorName } = req.body;
    if (!amountCents || amountCents < 100)
      return res.status(400).json({ error: 'Valor mínimo: R$ 1,00' });

    const PK = CONFIG.pagamento.pk;
    const SK = CONFIG.pagamento.sk;

    if (!PK || !SK)
      return res.status(500).json({ error: 'Credenciais de pagamento não configuradas no servidor' });

    const creds = Buffer.from(`${PK}:${SK}`).toString('base64');

    const response = await fetch('https://app.xflowpayments.com/api/v1/charges', {
      method: 'POST',
      headers: { 'Authorization': `Basic ${creds}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        amountCents,
        description: `Doação — ${CONFIG.campanha.nome}`,
        customer: {
          name: donorName || 'Doador Anônimo',
          email: 'doador@vakinha.com.br',
          document: '00000000000'
        },
        external_reference: `ester-${Date.now()}`
      })
    });

    const data = await response.json();
    if (!response.ok)
      return res.status(response.status).json({ error: data.message || 'Erro na API de pagamento' });

    res.json({
      id: data.id,
      qrCodeBase64: data.pix?.qrCodeBase64,
      copyPaste: data.pix?.copyPaste
    });
  } catch (err) {
    console.error('Erro /criar-cobranca:', err);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// ─── Painel Admin e Site ─────────────────────────────────────────
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/health', (req, res) => res.json({
  status: 'ok',
  pk_set: !!CONFIG.pagamento.pk,
  db: dbConectado ? 'mongodb' : 'memory'
}));

// ─── Start ───────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
conectarMongo().then(() => {
  app.listen(PORT, () => console.log(`✅ Servidor na porta ${PORT} | DB: ${dbConectado ? 'MongoDB' : 'memória'} | PK: ${CONFIG.pagamento.pk ? 'configurada' : 'AUSENTE'}`));
});
