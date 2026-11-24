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
  nome:         { type: String, default: 'Nova Campanha' },
  resumoCurto:  { type: String, default: '' },
  descricao:    { type: String, default: '' },
  localizacao:  { type: String, default: '' },
  categoria:    { type: String, default: '' },
  dataCriacao:  { type: String, default: '' },
  meta:         { type: Number, default: 140000 },
  status:       { type: String, default: 'ativa', enum: ['ativa','pausada','rascunho','encerrada'] },
  chavePix:     { type: String, default: '' },
  fotoUrl:      { type: String, default: '' },
  fotoBase64:   { type: String, default: '' },
  fotoMime:     { type: String, default: '' },
  idPublico:    { type: String, default: '' },
  slug:         { type: String, default: '', unique: false },
  videoUrl:     { type: String, default: '' },
  valores:      { type: [Number], default: [10, 25, 50, 100, 200] },
  upsell:       { type: Boolean, default: false },
  upsellTexto:  { type: String, default: 'Adicione mais e ajude ainda mais!' },
  arrecadado:   { type: Number, default: 0 },
  ordemExibicao: { type: Number, default: 0 },
  vakinhaPremiada: { type: String, default: '' },
  selos:        { type: [String], default: [] },
  perguntas: [{
    pergunta: { type: String, default: '' },
    resposta:  { type: String, default: '' },
    autor:     { type: String, default: '' }
  }],
  atualizacoes: [{
    titulo: { type: String, default: '' },
    texto:  { type: String, default: '' },
    data:   { type: String, default: '' }
  }]
}, { timestamps: true, versionKey: false, strict: false });

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
        resumoCurto: 'Olá, meu nome é Robson e sou pai da pequena Ester. É com o coração apertado e muita esperança que venho pedir a ajuda de vocês. Minha filha está enfrentando uma batalha muito difícil contra a leucemia.',
        descricao: process.env.CAMP_DESC || `Olá, meu nome é Robson e sou pai da pequena Ester.

É com o coração apertado e muita esperança que venho pedir a ajuda de vocês. Minha filha Ester está enfrentando uma batalha muito difícil: ela está passando por um tratamento contra a leucemia.

Ester é uma menina meiga, doce e cheia de vida. Como pai, tudo o que mais desejo neste momento é poder estar ao lado dela, dando todo o amor, apoio e força que ela precisa para enfrentar essa fase tão delicada.

Nós moramos em Barcarena, no Pará, e diariamente preciso me deslocar até Belém para acompanhar minha filha durante o tratamento. São viagens, alimentação, transporte e outras despesas que acabam pesando muito no orçamento da nossa família.

Infelizmente, essa não é a primeira vez que o câncer entra na nossa família. Minha esposa, mãe da Ester, também enfrentou essa doença e, infelizmente, acabou falecendo por causa dela. Desde então, tenho seguido em frente tentando ser forte pela minha filha e fazer tudo o que estiver ao meu alcance para protegê-la.

Hoje, estou aqui deixando de lado qualquer orgulho e pedindo ajuda. Não estou fazendo isso por mim, mas pela minha pequena Ester. Quero poder continuar acompanhando seu tratamento e proporcionar a ela tudo o que estiver ao meu alcance durante essa caminhada.

Qualquer contribuição, independentemente do valor, será muito importante para nós. E se você não puder contribuir financeiramente, compartilhar esta vakinha com outras pessoas já será uma enorme ajuda.

Peço, de coração, que você inclua a Ester em suas orações e torça pela recuperação dela.

Por favor, nos ajude a dar à pequena Ester a chance de continuar lutando e, um dia, poder voltar a viver sua infância com toda a alegria que ela merece.`,
        localizacao: 'Barcarena / PA',
        categoria: 'Solidariedade / Saúde',
        dataCriacao: '20/08/2026',
        meta: parseFloat(process.env.CAMP_META) || 140000,
        status: 'ativa',
        chavePix: process.env.CAMP_PIX || '',
        fotoUrl: process.env.CAMP_FOTO || '',
        valores: [10, 25, 50, 100, 200],
        upsell: 3.99,
        perguntas: [
          { pergunta: 'O dinheiro arrecadado vai realmente para o tratamento da Ester?', resposta: 'Sim! Todas as doações são destinadas diretamente ao custeio do tratamento, incluindo transporte de Barcarena para Belém, hospedagem durante os ciclos de quimioterapia, alimentação e medicamentos não fornecidos pelo SUS.', autor: 'Ana Lima' },
          { pergunta: 'Qual é o tipo de leucemia que a Ester tem?', resposta: 'A Ester foi diagnosticada com Leucemia Linfoblástica Aguda (LLA), que é o tipo mais comum em crianças. Ela está na fase de consolidação da quimioterapia. Os médicos têm boas expectativas para a recuperação dela.', autor: 'Carlos Mendes' },
          { pergunta: 'Posso acompanhar como o dinheiro está sendo utilizado?', resposta: 'Com certeza! O Robson publica atualizações frequentes na aba "Atualizações" com fotos, recibos e relatos de como cada centavo está sendo usado. A transparência é fundamental para nós.', autor: 'Fernanda Costa' }
        ],
        atualizacoes: [
          { titulo: 'Hoje foi dia de quimioterapia', texto: 'Ester passou pela 8ª sessão de quimio hoje em Belém. Ela estava cansada, mas sorriu para os enfermeiros que já a conhecem pelo nome. Cada sessão é um passo mais perto da cura! Obrigado a todos que tornaram essa viagem possível. 🙏', data: '19/11/2026' },
          { titulo: 'Atualização médica — boas notícias!', texto: 'Os exames desta semana mostraram resposta positiva ao tratamento. A médica responsável ficou animada com os resultados. Ainda temos um caminho longo, mas cada resultado bom renova nossas forças. Graças a Deus e a vocês!', data: '12/11/2026' },
          { titulo: 'Como o dinheiro foi usado em outubro', texto: 'Com as doações de outubro, conseguimos pagar: 14 passagens de ônibus Barcarena-Belém (R$ 420), hospedagem por 6 noites (R$ 480), alimentação durante o tratamento (R$ 310) e um medicamento específico não fornecido pelo SUS (R$ 180). Total: R$ 1.390.', data: '01/11/2026' }
        ]
      });
      console.log('📄 Campanha padrão migrada para MongoDB');
    } else {
      // Atualizar campos vazios na campanha existente
      const campExistente = await CampanhaModel.findOne({ status: 'ativa' });
      if (campExistente && !campExistente.descricao) {
        await CampanhaModel.findByIdAndUpdate(campExistente._id, { $set: {
          resumoCurto: 'Olá, meu nome é Robson e sou pai da pequena Ester. É com o coração apertado e muita esperança que venho pedir a ajuda de vocês. Minha filha está enfrentando uma batalha muito difícil contra a leucemia.',
          descricao: `Olá, meu nome é Robson e sou pai da pequena Ester.\n\nÉ com o coração apertado e muita esperança que venho pedir a ajuda de vocês. Minha filha Ester está enfrentando uma batalha muito difícil: ela está passando por um tratamento contra a leucemia.\n\nEster é uma menina meiga, doce e cheia de vida. Como pai, tudo o que mais desejo neste momento é poder estar ao lado dela, dando todo o amor, apoio e força que ela precisa para enfrentar essa fase tão delicada.\n\nNós moramos em Barcarena, no Pará, e diariamente preciso me deslocar até Belém para acompanhar minha filha durante o tratamento. São viagens, alimentação, transporte e outras despesas que acabam pesando muito no orçamento da nossa família.\n\nHoje, estou aqui deixando de lado qualquer orgulho e pedindo ajuda. Não estou fazendo isso por mim, mas pela minha pequena Ester. Quero poder continuar acompanhando seu tratamento e proporcionar a ela tudo o que estiver ao meu alcance durante essa caminhada.\n\nQualquer contribuição, independentemente do valor, será muito importante para nós.\n\nPeço, de coração, que você inclua a Ester em suas orações e torça pela recuperação dela.`,
          localizacao: campExistente.localizacao || 'Barcarena / PA',
          categoria: campExistente.categoria || 'Solidariedade / Saúde',
          dataCriacao: campExistente.dataCriacao || '20/08/2026',
          perguntas: campExistente.perguntas && campExistente.perguntas.length ? campExistente.perguntas : [
            { pergunta: 'O dinheiro arrecadado vai realmente para o tratamento?', resposta: 'Sim! Todas as doações são destinadas diretamente ao custeio do tratamento, incluindo transporte, hospedagem e medicamentos.', autor: '' },
            { pergunta: 'Posso acompanhar como o dinheiro está sendo utilizado?', resposta: 'Com certeza! Atualizações frequentes são publicadas na aba Atualizações com relatos de como cada centavo está sendo usado.', autor: '' }
          ],
          atualizacoes: campExistente.atualizacoes && campExistente.atualizacoes.length ? campExistente.atualizacoes : [
            { titulo: 'Hoje foi dia de quimioterapia', texto: 'Ester passou pela 8ª sessão de quimio hoje em Belém. Ela estava cansada, mas sorriu para os enfermeiros. Cada sessão é um passo mais perto da cura!', data: '19/11/2026' },
            { titulo: 'Atualização médica — boas notícias!', texto: 'Os exames desta semana mostraram resposta positiva ao tratamento. Ainda temos um caminho longo, mas cada resultado bom renova nossas forças.', data: '12/11/2026' }
          ]
        }});
        console.log('📄 Campanha existente atualizada com campos padrão');
      }
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
    const { nome, resumoCurto, descricao, localizacao, categoria, dataCriacao,
            meta, status, chavePix, fotoUrl, fotoBase64, fotoMime,
            valores, upsell, upsellTexto, perguntas, atualizacoes } = req.body;
    if (!nome) return res.status(400).json({ error: 'Nome obrigatório' });
    if (!dbConectado) {
      const nova = { _id: 'mem-'+Date.now(), nome, resumoCurto, descricao, localizacao, categoria, dataCriacao,
                     meta, status, chavePix, fotoUrl, fotoBase64, fotoMime,
                     slug: req.body.slug || '', videoUrl: req.body.videoUrl || '', selos: req.body.selos || [],
                     valores, upsell, upsellTexto, perguntas, atualizacoes, arrecadado: 0 };
      CAMPANHAS_MEM.push(nova);
      return res.json({ ok: true, _id: nova._id, campanha: nova });
    }
    const slug = req.body.slug || '';
    const videoUrl = req.body.videoUrl || '';
    const selos = req.body.selos || [];
    const c = await CampanhaModel.create({ nome, resumoCurto, descricao, localizacao, categoria, dataCriacao,
                                           meta, status, chavePix, fotoUrl, fotoBase64, fotoMime,
                                           slug, videoUrl, selos,
                                           valores, upsell, upsellTexto, perguntas, atualizacoes });
    res.json({ ok: true, _id: c._id, campanha: c });
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
    const c = await CampanhaModel.findByIdAndUpdate(id, { $set: campos }, { new: true, runValidators: false });
    if (!c) return res.status(404).json({ error: 'Campanha não encontrada' });
    res.json({ ok: true, campanha: c });
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

// Campanha ativa pública (site principal — 1ª ativa por ordem)
app.get('/campanha-ativa', async (req, res) => {
  try {
    if (!dbConectado) {
      const ativa = CAMPANHAS_MEM.find(c => c.status === 'ativa') || CAMPANHAS_MEM[0];
      return res.json({ campanha: ativa, marketing: CONFIG.marketing });
    }
    const c = await CampanhaModel.findOne({ status: 'ativa' }).sort({ ordemExibicao: 1, createdAt: 1 });
    if (!c) return res.json({ campanha: null, marketing: CONFIG.marketing });
    res.json({ campanha: c, marketing: CONFIG.marketing });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao buscar campanha' });
  }
});

// Busca campanha por slug (para links /c/:slug)
app.get('/campanha-por-slug/:slug', async (req, res) => {
  try {
    const { slug } = req.params;
    if (!dbConectado) {
      const c = CAMPANHAS_MEM.find(x => x.slug === slug) || null;
      return res.json({ campanha: c, marketing: CONFIG.marketing });
    }
    const c = await CampanhaModel.findOne({ slug });
    res.json({ campanha: c || null, marketing: CONFIG.marketing });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao buscar campanha' });
  }
});

// Rota /c/:slug → serve o index.html (o JS detecta o slug e carrega a campanha certa)
app.get('/c/:slug', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
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

// ─── Webhook XFlow — atualiza status do pagamento automaticamente ────
app.post('/webhook/xflow', async (req, res) => {
  try {
    const event = req.body;
    const chargeId = event.id || event.charge_id || event.data?.id;
    const status = event.status || event.data?.status || event.type;
    if (!chargeId) return res.json({ ok: true });

    const statusNormalizado = (status || '').toLowerCase().replace('charge.', '');
    const pago = ['paid', 'completed', 'approved'].includes(statusNormalizado);

    if (dbConectado && chargeId) {
      const pag = await PagamentoModel.findOne({ chargeId });
      if (pag) {
        const statusAnterior = pag.status;
        await PagamentoModel.findOneAndUpdate({ chargeId }, { $set: { status: statusNormalizado } });
        // Incrementar arrecadado apenas se for nova confirmação de pagamento
        if (pago && statusAnterior !== 'paid' && statusAnterior !== 'completed' && statusAnterior !== 'approved') {
          if (pag.campanhaId) {
            await CampanhaModel.findByIdAndUpdate(pag.campanhaId, { $inc: { arrecadado: pag.amountCents / 100 } });
          }
        }
      }
    }
    res.json({ ok: true });
  } catch (err) {
    console.error('Erro webhook:', err);
    res.status(500).json({ error: 'Erro interno' });
  }
});

// ─── Histórico de pagamentos (apenas reais: paid/completed/approved) ─
app.get('/admin/pagamentos', authMiddleware, async (req, res) => {
  try {
    if (!dbConectado) return res.json({ pagamentos: [] });
    const { campanhaId } = req.query;
    // Filtrar apenas pagamentos com status confirmado pela XFlow (pagamentos reais)
    const filtroStatus = { status: { $in: ['paid', 'completed', 'approved'] } };
    const filtro = campanhaId ? { campanhaId, ...filtroStatus } : filtroStatus;
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

    // Atualizar status no histórico (evita dupla contagem)
    if (dbConectado) {
      const pag = await PagamentoModel.findOne({ chargeId: id });
      if (pag) {
        const statusAnterior = pag.status;
        const jaFoiPago = ['paid','completed','approved'].includes(statusAnterior);
        await PagamentoModel.findOneAndUpdate({ chargeId: id }, { $set: { status: data.status } });
        // Incrementa arrecadado APENAS se ainda não estava pago antes
        if (pago && !jaFoiPago && pag.campanhaId) {
          await CampanhaModel.findByIdAndUpdate(pag.campanhaId, { $inc: { arrecadado: pag.amountCents / 100 } });
        }
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
