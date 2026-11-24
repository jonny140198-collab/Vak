const express = require('express');
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');
const mongoose = require('mongoose');
const app = express();

app.use(express.json({ limit: '25mb' }));
app.use(express.urlencoded({ extended: true, limit: '25mb' }));
app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));

// ─── Schema: Config global ────────────────────────────────────────
const configSchema = new mongoose.Schema({
  _id: { type: String, default: 'main' },
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

// ─── Schema: Campanha ─────────────────────────────────────────────
const campanhaSchema = new mongoose.Schema({
  nome:        { type: String, default: 'Nova Campanha' },
  resumoCurto: { type: String, default: '' },   // texto breve abaixo do título
  descricao:   { type: String, default: '' },   // aba "Sobre" completo
  localizacao: { type: String, default: '' },   // ex: "Barcarena / PA"
  categoria:   { type: String, default: 'SOLIDARIEDADE / SAÚDE' },
  dataCriacao: { type: String, default: '' },   // ex: "20/08/2026"
  meta:        { type: Number, default: 140000 },
  status:      { type: String, default: 'ativa', enum: ['ativa','pausada','rascunho'] },
  chavePix:    { type: String, default: '' },
  fotoUrl:     { type: String, default: '' },
  fotoBase64:  { type: String, default: '' },
  fotoMime:    { type: String, default: '' },
  valores:     { type: [Number], default: [10, 25, 50, 100, 200] },
  upsell:      { type: Number, default: 3.99 },
  upsellTexto: { type: String, default: 'Adicione mais e ajude ainda mais!' },
  arrecadado:  { type: Number, default: 0 },
  ordemExibicao: { type: Number, default: 0 },
  // Perguntas & Respostas
  perguntas: [{
    pergunta: { type: String, default: '' },
    resposta:  { type: String, default: '' },
    autor:     { type: String, default: '' }
  }],
  // Atualizações
  atualizacoes: [{
    titulo:    { type: String, default: '' },
    texto:     { type: String, default: '' },
    data:      { type: String, default: '' }
  }]
}, { timestamps: true, versionKey: false });

const CampanhaModel = mongoose.model('Campanha', campanhaSchema);

// ─── Schema: Pagamento (histórico) ───────────────────────────────
const pagamentoSchema = new mongoose.Schema({
  campanhaId:  { type: mongoose.Schema.Types.ObjectId, ref: 'Campanha' },
  chargeId:    { type: String },
  amountCents: { type: Number },
  donorName:   { type: String, default: 'Anônimo' },
  status:      { type: String, default: 'pending' }
}, { timestamps: true, versionKey: false });

const PagamentoModel = mongoose.model('Pagamento', pagamentoSchema);

// ─── Config em memória (fallback) ────────────────────────────────
let CONFIG = {
  pagamento: {
    pk: process.env.PAYMENT_PK || '',
    sk: process.env.PAYMENT_SK || ''
  },
  marketing: {
    pixelFacebook: process.env.PIXEL_FB || '',
    googleAnalytics: process.env.GA_ID || ''
  }
};

// Campanha em memória (fallback quando não tem MongoDB)
let CAMPANHAS_MEM = [{
  _id: 'default',
  nome: process.env.CAMP_NOME || 'Ajude a Pequena Ester',
  descricao: process.env.CAMP_DESC || 'Ester tem leucemia e precisa de tratamento urgente.',
  meta: parseFloat(process.env.CAMP_META) || 140000,
  status: 'ativa',
  chavePix: process.env.CAMP_PIX || '',
  fotoUrl: process.env.CAMP_FOTO || '',
  fotoBase64: '',
  fotoMime: '',
  valores: [10, 25, 50, 100, 200],
  upsell: 3.99,
  upsellTexto: 'Adicione mais e ajude ainda mais!',
  arrecadado: 0
}];

// ─── MongoDB ──────────────────────────────────────────────────────
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

    // Config global
    let doc = await ConfigModel.findById('main');
    if (!doc) {
      doc = await ConfigModel.create({ _id: 'main', ...CONFIG });
    } else {
      if (doc.pagamento.pk) CONFIG.pagamento.pk = doc.pagamento.pk;
      if (doc.pagamento.sk) CONFIG.pagamento.sk = doc.pagamento.sk;
      CONFIG.marketing = { ...CONFIG.marketing, ...doc.marketing.toObject() };
    }

    // Migrar campanha default do env para MongoDB (apenas 1ª vez)
    const count = await CampanhaModel.countDocuments();
    if (count === 0) {
      await CampanhaModel.create({
        nome: process.env.CAMP_NOME || 'Ajude a Pequena Ester',
        descricao: process.env.CAMP_DESC || 'Ester tem leucemia e precisa de tratamento urgente.',
        meta: parseFloat(process.env.CAMP_META) || 140000,
        status: 'ativa',
        chavePix: process.env.CAMP_PIX || '',
        fotoUrl: process.env.CAMP_FOTO || ''
      });
      console.log('📄 Campanha padrão migrada para MongoDB');
    }
  } catch (err) {
    console.error('❌ Erro ao conectar MongoDB:', err.message);
    console.log('⚠️  Continuando com config em memória');
  }
}

async function salvarConfigNoBanco() {
  if (!dbConectado) return;
  try {
    await ConfigModel.findByIdAndUpdate('main',
      { $set: { pagamento: CONFIG.pagamento, marketing: CONFIG.marketing } },
      { upsert: true, new: true });
  } catch (err) {
    console.error('❌ Erro ao salvar config:', err.message);
  }
}

// ─── Auth ─────────────────────────────────────────────────────────
const ADMIN_USER = process.env.ADMIN_USER || 'garciaST';
const ADMIN_PASS_HASH = crypto.createHash('sha256').update(process.env.ADMIN_PASS || 'Lu!131020').digest('hex');
const sessions = new Map();

function makeToken() { return crypto.randomBytes(32).toString('hex'); }
function authMiddleware(req, res, next) {
  const token = req.headers['x-admin-token'] || req.query.token;
  if (token && sessions.has(token)) return next();
  res.status(401).json({ error: 'Não autorizado' });
}

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

// ─── Config global (credenciais / marketing) ──────────────────────
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
  if (body.pagamento) {
    if (body.pagamento.pk) CONFIG.pagamento.pk = body.pagamento.pk;
    if (body.pagamento.sk && !body.pagamento.sk.includes('•')) CONFIG.pagamento.sk = body.pagamento.sk;
  }
  if (body.marketing) CONFIG.marketing = { ...CONFIG.marketing, ...body.marketing };
  await salvarConfigNoBanco();
  res.json({ ok: true, persistido: dbConectado });
});

// ─── CRUD Campanhas ───────────────────────────────────────────────

// Listar
app.get('/admin/campanhas', authMiddleware, async (req, res) => {
  try {
    if (!dbConectado) return res.json({ campanhas: CAMPANHAS_MEM });
    const campanhas = await CampanhaModel.find().sort({ ordemExibicao: 1, createdAt: 1 });
    res.json({ campanhas });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao listar campanhas' });
  }
});

// Criar
app.post('/admin/campanhas', authMiddleware, async (req, res) => {
  try {
    const { nome, descricao, meta, status, chavePix, fotoUrl, fotoBase64, fotoMime, valores, upsell, upsellTexto } = req.body;
    if (!nome) return res.status(400).json({ error: 'Nome obrigatório' });
    if (!dbConectado) {
      const nova = { _id: 'mem-'+Date.now(), nome, descricao, meta, status, chavePix, fotoUrl, fotoBase64, fotoMime, valores, upsell, upsellTexto, arrecadado: 0 };
      CAMPANHAS_MEM.push(nova);
      return res.json({ ok: true, _id: nova._id });
    }
    const c = await CampanhaModel.create({ nome, descricao, meta, status, chavePix, fotoUrl, fotoBase64, fotoMime, valores, upsell, upsellTexto });
    res.json({ ok: true, _id: c._id });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao criar campanha' });
  }
});

// Atualizar
app.put('/admin/campanhas/:id', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const campos = req.body;
    if (!dbConectado) {
      const idx = CAMPANHAS_MEM.findIndex(c => c._id === id);
      if (idx < 0) return res.status(404).json({ error: 'Não encontrada' });
      CAMPANHAS_MEM[idx] = { ...CAMPANHAS_MEM[idx], ...campos };
      return res.json({ ok: true });
    }
    const c = await CampanhaModel.findByIdAndUpdate(id, { $set: campos }, { new: true });
    if (!c) return res.status(404).json({ error: 'Campanha não encontrada' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao atualizar campanha' });
  }
});

// Excluir
app.delete('/admin/campanhas/:id', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    if (!dbConectado) {
      CAMPANHAS_MEM = CAMPANHAS_MEM.filter(c => c._id !== id);
      return res.json({ ok: true });
    }
    await CampanhaModel.findByIdAndDelete(id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao excluir campanha' });
  }
});

// Campanha ativa pública (site principal usa a 1ª campanha ativa)
app.get('/campanha-ativa', async (req, res) => {
  try {
    const { c } = req.query; // ID específico de campanha via ?c=ID
    if (!dbConectado) {
      let ativa;
      if (c) {
        ativa = CAMPANHAS_MEM.find(x => x._id == c || x.id == c);
      }
      ativa = ativa || CAMPANHAS_MEM.find(x => x.status === 'ativa') || CAMPANHAS_MEM[0];
      return res.json({ campanha: ativa, marketing: CONFIG.marketing });
    }
    let campanha;
    if (c) {
      // Busca campanha específica pelo ID
      try {
        campanha = await CampanhaModel.findById(c);
      } catch(e) { campanha = null; }
    }
    // Fallback: primeira campanha ativa
    if (!campanha) {
      campanha = await CampanhaModel.findOne({ status: 'ativa' }).sort({ ordemExibicao: 1, createdAt: 1 });
    }
    if (!campanha) return res.json({ campanha: null, marketing: CONFIG.marketing });
    res.json({ campanha, marketing: CONFIG.marketing });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao buscar campanha' });
  }
});

// Config pública legada (compatibilidade com index.html antigo)
app.get('/config-publica', async (req, res) => {
  try {
    let campanha = CAMPANHAS_MEM.find(c => c.status === 'ativa') || CAMPANHAS_MEM[0];
    if (dbConectado) {
      campanha = await CampanhaModel.findOne({ status: 'ativa' }).sort({ ordemExibicao: 1, createdAt: 1 });
    }
    res.json({
      campanha: campanha || {},
      marketing: CONFIG.marketing
    });
  } catch (err) {
    res.status(500).json({ error: 'Erro' });
  }
});

// ─── Histórico de pagamentos ──────────────────────────────────────
app.get('/admin/pagamentos', authMiddleware, async (req, res) => {
  try {
    if (!dbConectado) return res.json({ pagamentos: [] });
    const { campanhaId } = req.query;
    const filtro = campanhaId ? { campanhaId } : {};
    const pagamentos = await PagamentoModel.find(filtro).sort({ createdAt: -1 }).limit(200);
    res.json({ pagamentos });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao listar pagamentos' });
  }
});

// ─── Rota Pix (criar cobrança) ────────────────────────────────────
app.post('/criar-cobranca', async (req, res) => {
  try {
    const { amountCents, donorName, campanhaId } = req.body;
    if (!amountCents || amountCents < 100)
      return res.status(400).json({ error: 'Valor mínimo: R$ 1,00' });

    const PK = CONFIG.pagamento.pk;
    const SK = CONFIG.pagamento.sk;
    if (!PK || !SK)
      return res.status(500).json({ error: 'Credenciais de pagamento não configuradas' });

    // Buscar nome da campanha
    let campanhaNome = 'Ajude a Pequena Ester';
    if (campanhaId) {
      if (dbConectado) {
        const c = await CampanhaModel.findById(campanhaId);
        if (c) campanhaNome = c.nome;
      } else {
        const c = CAMPANHAS_MEM.find(x => x._id === campanhaId);
        if (c) campanhaNome = c.nome;
      }
    }

    const creds = Buffer.from(`${PK}:${SK}`).toString('base64');
    const response = await fetch('https://app.xflowpayments.com/api/v1/charges', {
      method: 'POST',
      headers: { 'Authorization': `Basic ${creds}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        amountCents,
        description: `Doação — ${campanhaNome}`,
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

    // Salvar registro no histórico
    if (dbConectado) {
      await PagamentoModel.create({
        campanhaId: campanhaId || null,
        chargeId: data.id,
        amountCents,
        donorName: donorName || 'Anônimo',
        status: 'pending'
      });
    }

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

// ─── Status do pagamento ──────────────────────────────────────────
app.get('/status-cobranca/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const PK = CONFIG.pagamento.pk;
    const SK = CONFIG.pagamento.sk;
    if (!PK || !SK) return res.status(500).json({ error: 'Credenciais não configuradas' });

    const creds = Buffer.from(`${PK}:${SK}`).toString('base64');
    const response = await fetch(`https://app.xflowpayments.com/api/v1/charges/${id}`, {
      headers: { 'Authorization': `Basic ${creds}` }
    });
    const data = await response.json();
    if (!response.ok) return res.status(response.status).json({ error: data.message || 'Erro ao consultar' });

    const pago = data.status === 'paid' || data.status === 'completed' ||
                 data.status === 'approved' || data.pix?.status === 'paid' ||
                 data.pix?.status === 'completed';

    // Atualizar status no histórico
    if (dbConectado && pago) {
      await PagamentoModel.findOneAndUpdate({ chargeId: id }, { $set: { status: data.status } });
      // Incrementar arrecadado na campanha
      const pag = await PagamentoModel.findOne({ chargeId: id });
      if (pag && pag.campanhaId) {
        await CampanhaModel.findByIdAndUpdate(pag.campanhaId, { $inc: { arrecadado: pag.amountCents / 100 } });
      }
    }

    res.json({ id: data.id, status: data.status, pago });
  } catch (err) {
    console.error('Erro /status-cobranca:', err);
    res.status(500).json({ error: 'Erro interno' });
  }
});

// ─── Static ───────────────────────────────────────────────────────
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/health', (req, res) => res.json({ status: 'ok', pk_set: !!CONFIG.pagamento.pk, db: dbConectado ? 'mongodb' : 'memory' }));

// ─── Start ────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
conectarMongo().then(() => {
  app.listen(PORT, () => console.log(`✅ Servidor na porta ${PORT} | DB: ${dbConectado ? 'MongoDB' : 'memória'} | PK: ${CONFIG.pagamento.pk ? 'OK' : 'AUSENTE'}`));
});
