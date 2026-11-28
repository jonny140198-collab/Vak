const express = require('express');
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');
const mongoose = require('mongoose');
const app = express();

// ─── Headers de segurança HTTP ────────────────────────────────────
app.use((req, res, next) => {
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  // Impede que o site seja embutido em iframes de outros domínios
  res.setHeader('Content-Security-Policy',
    "default-src 'self'; " +
    "script-src 'self' 'unsafe-inline'; " +
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
    "font-src 'self' https://fonts.gstatic.com data:; " +
    "img-src 'self' data: blob: https:; " +
    "connect-src 'self' https://vak-led3.onrender.com https://app.xflowpayments.com; " +
    "frame-ancestors 'none';"
  );
  next();
});

// ─── CORS restrito ao próprio domínio ────────────────────────────
const ALLOWED_ORIGINS = [
  'https://vak-led3.onrender.com',
  'http://localhost:3000',
  'http://127.0.0.1:3000'
];
app.use(cors({
  origin: function(origin, callback) {
    // Permite requisições sem origin (mobile apps, Postman, etc.) ou do próprio domínio
    if (!origin || ALLOWED_ORIGINS.includes(origin)) return callback(null, true);
    callback(new Error('CORS bloqueado'));
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'x-admin-token']
}));

app.use(express.json({ limit: '25mb' }));
app.use(express.urlencoded({ extended: true, limit: '25mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ─── Rate limit para login (anti brute-force) ────────────────────
const loginAttempts = new Map(); // ip -> { count, firstAt }
const MAX_LOGIN_ATTEMPTS = 5;    // máximo de tentativas
const LOGIN_WINDOW_MS = 15 * 60 * 1000; // janela de 15 min
const LOCKOUT_MS = 30 * 60 * 1000;      // bloqueio por 30 min

function checkLoginRateLimit(ip) {
  const now = Date.now();
  const entry = loginAttempts.get(ip);
  if (!entry) return true;
  // Reseta a janela se já passou o tempo
  if (now - entry.firstAt > LOGIN_WINDOW_MS) {
    loginAttempts.delete(ip);
    return true;
  }
  if (entry.count >= MAX_LOGIN_ATTEMPTS) {
    // Dentro do lockout?
    if (now - entry.firstAt < LOCKOUT_MS) return false;
    loginAttempts.delete(ip);
    return true;
  }
  return true;
}

function recordLoginFailure(ip) {
  const now = Date.now();
  const entry = loginAttempts.get(ip);
  if (!entry || now - entry.firstAt > LOGIN_WINDOW_MS) {
    loginAttempts.set(ip, { count: 1, firstAt: now });
  } else {
    entry.count++;
  }
}

// Limpeza periódica do mapa de tentativas (a cada 1h)
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of loginAttempts.entries()) {
    if (now - entry.firstAt > LOCKOUT_MS) loginAttempts.delete(ip);
  }
}, 60 * 60 * 1000);

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
  owner:        { type: String, default: '' },  // username do admin dono da campanha
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
  upsellValor:  { type: Number, default: 3.99 },
  // Textos editáveis do checkout
  checkoutNome:         { type: String, default: '' },  // nome no mini-card do checkout
  textoAgradecimento:   { type: String, default: '' },  // título "Que Deus abençoe você!"
  textoAgradecimentoP1: { type: String, default: '' },  // 1º parágrafo da tela de sucesso
  textoAgradecimentoP2: { type: String, default: '' },  // 2º parágrafo
  textoAgradecimentoP3: { type: String, default: '' },  // 3º parágrafo
  textoUpsellTitulo:    { type: String, default: '' },  // "Deseja adicionar R$..."
  textoUpsellSub:       { type: String, default: '' },  // subtexto do upsell
  arrecadado:        { type: Number, default: 0 },
  arrecadadoBase:    { type: Number, default: 0 },   // valor base de exibição (histórico externo)
  apoiadoresBase:    { type: Number, default: 0 },   // apoiadores base de exibição
  coracoesBase:      { type: Number, default: 0 },   // corações base de exibição
  coracaoAtivo:      { type: Boolean, default: false },
  coracaoValor:      { type: Number, default: 2 },   // valor em R$ por coração
  coracaoTexto:      { type: String, default: 'Envie um ❤️ e ajude a impulsionar esta campanha!' },
  ordemExibicao: { type: Number, default: 0 },
  vakinhaPremiada: { type: mongoose.Schema.Types.Mixed, default: {} },
  quemAjudou:      { type: mongoose.Schema.Types.Mixed, default: {} },
  selos:        { type: [String], default: [] },
  perguntas: [{
    pergunta: { type: String, default: '' },
    resposta:  { type: String, default: '' },
    autor:     { type: String, default: '' }
  }],
  atualizacoes: [{
    titulo:    { type: String, default: '' },
    texto:     { type: String, default: '' },
    data:      { type: String, default: '' },
    midiaBase64: { type: String, default: '' },  // imagem em base64
    midiaMime:   { type: String, default: '' },  // image/jpeg, image/png…
    midiaUrl:    { type: String, default: '' }   // URL de vídeo (YouTube/etc)
  }]
}, { timestamps: true, versionKey: false, strict: false });

const CampanhaModel = mongoose.model('Campanha', campanhaSchema);

// ─── Schema: Pagamento (histórico) ───────────────────────────────
const pagamentoSchema = new mongoose.Schema({
  campanhaId:  { type: mongoose.Schema.Types.ObjectId, ref: 'Campanha' },
  chargeId:    { type: String },
  amountCents: { type: Number },
  tipo:        { type: String, default: 'doacao' }, // 'doacao' | 'coracao'
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
  nome: process.env.CAMP_NOME || 'Tupanciretã: ajude quem perdeu tudo',
  descricao: process.env.CAMP_DESC || '🆘 Tupanciretã e o Rio Grande do Sul precisam de você. Doe ag...',
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
        nome: process.env.CAMP_NOME || 'Tupanciretã: ajude quem perdeu tudo',
        idPublico: '554896',
        resumoCurto: '🆘 Tupanciretã (RS) precisa de nós! Uma tempestade com ventos de 114 km/h destruiu 7.796 casas e afetou mais de 20 mil pessoas. Estado de Calamidade Pública decretado. Sua doação vira lona, telha, colchão, água e comida para quem perdeu tudo. 🚨 Doe agora e compartilhe!',
        descricao: process.env.CAMP_DESC || `🆘 Tupanciretã e o Rio Grande do Sul precisam de você. Doe agora!

Uma tempestade severa, com ventos de até 114 km/h (supercélula e microexplosão atmosférica) e chuva de granizo, atingiu Tupanciretã, e o Rio Grande do Sul volta a se mobilizar em modo de emergência.

Num município de cerca de 20 mil habitantes, praticamente todos foram afetados de alguma forma. Os números oficiais já somam 5 óbitos, 265 feridos, 40 desabrigados e 19.780 desalojados. São 7.796 casas destelhadas, mais de mil árvores caídas e redes de energia, água e infraestrutura pública destruídas, incluindo o Hospital de Caridade e escolas da cidade. O governo decretou Estado de Calamidade Pública, e o socorro imediato é uma questão de sobrevivência.

Em 2024, o Instituto Vakinha mobilizou o Brasil, arrecadou R$ 80 milhões e apoiou mais de 600 instituições e milhares de vidas no Rio Grande do Sul. Agora, em novembro de 2026, a emergência bate à porta outra vez, e a ajuda precisa chegar depressa a quem perdeu tudo em poucas horas.

🤝 Uma rede unida, atuando na ponta
Nesta frente emergencial, o Instituto Vakinha se une a parceiros que já estão em campo para levar uma resposta rápida e organizada às áreas atingidas: Bonanza, OIM (Agência da ONU para as Migrações), GRAD (Resgate Animal e Saúde Única), Humus e outras instituições parceiras.

Todo o valor arrecadado nesta campanha oficial será repassado com agilidade e transparência para:

Sobrevivência e abrigo: lonas, telhas, colchões, cobertores, kits de higiene, água potável e alimentos para quem teve a casa atingida e ficou desalojado ou desabrigado;
Apoio a feridos e emergências: suporte às equipes de atendimento, resgate e acolhimento no local;
Fortalecimento de quem está na linha de frente: repasse direto a organizações parceiras, entidades locais e frentes humanitárias que atuam em Tupanciretã e região.
O que os dados oficiais mostram:

5 óbitos e 265 feridos
19.780 desalojados e 40 desabrigados
7.796 casas destelhadas
Hospital de Caridade, escolas, energia e água atingidos

🚨 Doe AGORA: cada contribuição faz diferença imediata para reerguer telhados, aquecer famílias e manter de pé o atendimento de emergência.`,
        localizacao: 'Tupanciretã / RS',
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
      // Sempre atualizar campos principais da campanha existente
      const campExistente = await CampanhaModel.findOne({ status: 'ativa' });
      if (campExistente) {
        await CampanhaModel.findByIdAndUpdate(campExistente._id, { $set: {
          nome: 'Tupanciretã: ajude quem perdeu tudo',
          idPublico: campExistente.idPublico || '554896',
          resumoCurto: '🆘 Tupanciretã (RS) precisa de nós! Uma tempestade com ventos de 114 km/h destruiu 7.796 casas e afetou mais de 20 mil pessoas. Estado de Calamidade Pública decretado. Sua doação vira lona, telha, colchão, água e comida para quem perdeu tudo. 🚨 Doe agora e compartilhe!',
          descricao: `🆘 Tupanciretã e o Rio Grande do Sul precisam de você. Doe agora!

Uma tempestade severa, com ventos de até 114 km/h (supercélula e microexplosão atmosférica) e chuva de granizo, atingiu Tupanciretã, e o Rio Grande do Sul volta a se mobilizar em modo de emergência.

Num município de cerca de 20 mil habitantes, praticamente todos foram afetados de alguma forma. Os números oficiais já somam 5 óbitos, 265 feridos, 40 desabrigados e 19.780 desalojados. São 7.796 casas destelhadas, mais de mil árvores caídas e redes de energia, água e infraestrutura pública destruídas, incluindo o Hospital de Caridade e escolas da cidade. O governo decretou Estado de Calamidade Pública, e o socorro imediato é uma questão de sobrevivência.

Em 2024, o Instituto Vakinha mobilizou o Brasil, arrecadou R$ 80 milhões e apoiou mais de 600 instituições e milhares de vidas no Rio Grande do Sul. Agora, em novembro de 2026, a emergência bate à porta outra vez, e a ajuda precisa chegar depressa a quem perdeu tudo em poucas horas.

🤝 Uma rede unida, atuando na ponta
Nesta frente emergencial, o Instituto Vakinha se une a parceiros que já estão em campo para levar uma resposta rápida e organizada às áreas atingidas: Bonanza, OIM (Agência da ONU para as Migrações), GRAD (Resgate Animal e Saúde Única), Humus e outras instituições parceiras.

Todo o valor arrecadado nesta campanha oficial será repassado com agilidade e transparência para:

Sobrevivência e abrigo: lonas, telhas, colchões, cobertores, kits de higiene, água potável e alimentos para quem teve a casa atingida e ficou desalojado ou desabrigado;
Apoio a feridos e emergências: suporte às equipes de atendimento, resgate e acolhimento no local;
Fortalecimento de quem está na linha de frente: repasse direto a organizações parceiras, entidades locais e frentes humanitárias que atuam em Tupanciretã e região.
O que os dados oficiais mostram:

5 óbitos e 265 feridos
19.780 desalojados e 40 desabrigados
7.796 casas destelhadas
Hospital de Caridade, escolas, energia e água atingidos

🚨 Doe AGORA: cada contribuição faz diferença imediata para reerguer telhados, aquecer famílias e manter de pé o atendimento de emergência.`,
          localizacao: 'Tupanciretã / RS',
          categoria: 'Solidariedade / Emergência',
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
// ─── Schema: AdminUser ────────────────────────────────────────────
const adminUserSchema = new mongoose.Schema({
  usuario:    { type: String, required: true, unique: true },
  senhaHash:  { type: String, required: true },
  role:       { type: String, default: 'comum', enum: ['master', 'comum'] },
  ativo:      { type: Boolean, default: true },
  paymentPk:  { type: String, default: '' },  // Public Key XFlow do admin
  paymentSk:  { type: String, default: '' }   // Secret Key XFlow — NUNCA exposta ao frontend
}, { timestamps: true, versionKey: false });
const AdminUserModel = mongoose.model('AdminUser', adminUserSchema);

// ─── Auth ─────────────────────────────────────────────────────────
const ADMIN_USER = process.env.ADMIN_USER || 'garciaST';
const ADMIN_PASS_HASH = crypto.createHash('sha256').update(process.env.ADMIN_PASS || 'Lu!131020').digest('hex');
const sessions = new Map(); // token -> { user, role, at }
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;

function makeToken() { return crypto.randomBytes(32).toString('hex'); }
function hashSenha(s) { return crypto.createHash('sha256').update(s).digest('hex'); }

function authMiddleware(req, res, next) {
  const token = req.headers['x-admin-token'] || req.query.token;
  if (token && sessions.has(token)) {
    const sess = sessions.get(token);
    if (Date.now() - sess.at < SESSION_TTL_MS) {
      req.adminUser = sess.user;
      req.adminRole = sess.role || 'comum';
      return next();
    }
    sessions.delete(token);
  }
  res.status(401).json({ error: 'Não autorizado' });
}

// Middleware exclusivo para o admin master
function masterOnly(req, res, next) {
  if (req.adminRole === 'master') return next();
  res.status(403).json({ error: 'Acesso restrito ao administrador principal' });
}

// Limpeza de sessões expiradas a cada hora
setInterval(() => {
  const now = Date.now();
  for (const [tok, sess] of sessions.entries()) {
    if (now - sess.at >= SESSION_TTL_MS) sessions.delete(tok);
  }
}, 60 * 60 * 1000);

app.post('/admin/login', async (req, res) => {
  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket.remoteAddress || 'unknown';
  if (!checkLoginRateLimit(ip)) {
    return res.status(429).json({ error: 'Muitas tentativas. Aguarde 30 minutos.' });
  }
  const { usuario, senha } = req.body;
  const senhaHash = hashSenha(senha || '');

  // 1) Verifica admin master (variáveis de ambiente)
  if (usuario === ADMIN_USER && senhaHash === ADMIN_PASS_HASH) {
    loginAttempts.delete(ip);
    const token = makeToken();
    sessions.set(token, { user: usuario, role: 'master', at: Date.now() });
    return res.json({ ok: true, token, role: 'master' });
  }

  // 2) Verifica admins cadastrados no banco
  if (dbConectado) {
    try {
      const u = await AdminUserModel.findOne({ usuario, ativo: true });
      if (u && u.senhaHash === senhaHash) {
        loginAttempts.delete(ip);
        const token = makeToken();
        sessions.set(token, { user: usuario, role: u.role || 'comum', at: Date.now() });
        return res.json({ ok: true, token, role: u.role || 'comum' });
      }
    } catch(e) { /* ignora erro de DB e cai no 401 */ }
  }

  recordLoginFailure(ip);
  const entry = loginAttempts.get(ip);
  const restantes = Math.max(0, MAX_LOGIN_ATTEMPTS - (entry?.count || 0));
  res.status(401).json({ error: 'Usuário ou senha incorretos', tentativasRestantes: restantes });
});

app.post('/admin/logout', authMiddleware, (req, res) => {
  sessions.delete(req.headers['x-admin-token']);
  res.json({ ok: true });
});

// Retorna dados do usuário logado
app.get('/admin/me', authMiddleware, (req, res) => {
  res.json({ usuario: req.adminUser, role: req.adminRole });
});

// ─── CRUD de usuários admin (só master) ──────────────────────────
app.get('/admin/usuarios', authMiddleware, masterOnly, async (req, res) => {
  try {
    const lista = await AdminUserModel.find().select('-senhaHash -paymentSk').sort({ createdAt: 1 });
    res.json({ usuarios: lista });
  } catch(e) { res.status(500).json({ error: 'Erro ao listar usuários' }); }
});

app.post('/admin/usuarios', authMiddleware, masterOnly, async (req, res) => {
  try {
    const { usuario, senha, role } = req.body;
    if (!usuario || !senha) return res.status(400).json({ error: 'Usuário e senha obrigatórios' });
    if (senha.length < 6)   return res.status(400).json({ error: 'Senha mínima de 6 caracteres' });
    if (usuario === ADMIN_USER) return res.status(400).json({ error: 'Nome de usuário reservado' });
    const existe = await AdminUserModel.findOne({ usuario });
    if (existe) return res.status(400).json({ error: 'Usuário já existe' });
    const u = await AdminUserModel.create({ usuario, senhaHash: hashSenha(senha), role: role || 'comum' });
    res.json({ ok: true, usuario: { _id: u._id, usuario: u.usuario, role: u.role, ativo: u.ativo } });
  } catch(e) { res.status(500).json({ error: 'Erro ao criar usuário' }); }
});

app.put('/admin/usuarios/:id', authMiddleware, masterOnly, async (req, res) => {
  try {
    const { senha, role, ativo } = req.body;
    const campos = {};
    if (senha) {
      if (senha.length < 6) return res.status(400).json({ error: 'Senha mínima de 6 caracteres' });
      campos.senhaHash = hashSenha(senha);
    }
    if (role)   campos.role  = role;
    if (ativo !== undefined) campos.ativo = ativo;
    const u = await AdminUserModel.findByIdAndUpdate(req.params.id, { $set: campos }, { new: true }).select('-senhaHash');
    if (!u) return res.status(404).json({ error: 'Usuário não encontrado' });
    res.json({ ok: true, usuario: u });
  } catch(e) { res.status(500).json({ error: 'Erro ao atualizar usuário' }); }
});

app.delete('/admin/usuarios/:id', authMiddleware, masterOnly, async (req, res) => {
  try {
    await AdminUserModel.findByIdAndDelete(req.params.id);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: 'Erro ao excluir usuário' }); }
});

// ─── Config global (credenciais / marketing) ──────────────────────
app.get('/admin/config', authMiddleware, async (req, res) => {
  // Para admins comuns: retorna as credenciais DO PRÓPRIO admin (não as globais)
  if (req.adminRole !== 'master') {
    try {
      const u = dbConectado ? await AdminUserModel.findOne({ usuario: req.adminUser }) : null;
      return res.json({
        pagamento: {
          pk: u ? u.paymentPk : '',
          hasPaymentSk: u ? !!u.paymentSk : false
        },
        marketing: CONFIG.marketing,
        _db: dbConectado
      });
    } catch(e) {
      return res.json({ pagamento: { pk: '', hasPaymentSk: false }, marketing: CONFIG.marketing, _db: dbConectado });
    }
  }
  // Master: retorna config global
  const cfg = JSON.parse(JSON.stringify(CONFIG));
  if (cfg.pagamento?.sk) {
    cfg.pagamento.hasPaymentSk = true;
    cfg.pagamento.sk_masked = cfg.pagamento.sk.slice(0, 10) + '••••••••••••••••';
    delete cfg.pagamento.sk;
  } else {
    cfg.pagamento.hasPaymentSk = false;
  }
  cfg._db = dbConectado;
  res.json(cfg);
});

app.post('/admin/config', authMiddleware, async (req, res) => {
  const body = req.body;
  // Admins comuns salvam credenciais apenas na sua própria conta no banco
  if (req.adminRole !== 'master') {
    if (!dbConectado) return res.status(503).json({ error: 'Banco de dados não disponível' });
    try {
      const campos = {};
      if (body.pagamento?.pk) campos.paymentPk = body.pagamento.pk;
      if (body.pagamento?.sk && !body.pagamento.sk.includes('•')) campos.paymentSk = body.pagamento.sk;
      if (Object.keys(campos).length === 0) return res.json({ ok: true });
      await AdminUserModel.findOneAndUpdate({ usuario: req.adminUser }, { $set: campos });
      return res.json({ ok: true, persistido: true });
    } catch(e) { return res.status(500).json({ error: 'Erro ao salvar credenciais' }); }
  }
  // Master: salva config global
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
    if (!dbConectado) {
      // Em memória: master vê tudo, comum vê apenas as suas
      const lista = req.adminRole === 'master'
        ? CAMPANHAS_MEM
        : CAMPANHAS_MEM.filter(c => c.owner === req.adminUser);
      return res.json({ campanhas: lista });
    }
    // Master vê todas; comum vê apenas as suas
    const filtro = req.adminRole === 'master' ? {} : { owner: req.adminUser };
    const campanhas = await CampanhaModel.find(filtro).sort({ ordemExibicao: 1, createdAt: 1 });
    const result = campanhas.map(c => c.toObject());
    res.json({ campanhas: result });
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
    const c = await CampanhaModel.create({ owner: req.adminUser, nome, resumoCurto, descricao, localizacao, categoria, dataCriacao,
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
    // Nunca permite alterar o campo owner via PUT
    delete campos.owner;
    if (!dbConectado) {
      const idx = CAMPANHAS_MEM.findIndex(c => c._id === id);
      if (idx < 0) return res.status(404).json({ error: 'Não encontrada' });
      // Verifica propriedade para admins comuns
      if (req.adminRole !== 'master' && CAMPANHAS_MEM[idx].owner !== req.adminUser)
        return res.status(403).json({ error: 'Sem permissão para editar esta campanha' });
      CAMPANHAS_MEM[idx] = { ...CAMPANHAS_MEM[idx], ...campos };
      return res.json({ ok: true });
    }
    // Para admins comuns: verifica ownership antes de atualizar
    if (req.adminRole !== 'master') {
      const existing = await CampanhaModel.findById(id);
      if (!existing) return res.status(404).json({ error: 'Campanha não encontrada' });
      if (existing.owner !== req.adminUser) return res.status(403).json({ error: 'Sem permissão para editar esta campanha' });
    }
    const c = await CampanhaModel.findByIdAndUpdate(id, { $set: campos }, { new: true, runValidators: false });
    if (!c) return res.status(404).json({ error: 'Campanha não encontrada' });
    res.json({ ok: true, campanha: c.toObject() });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao atualizar campanha' });
  }
});

// Atualizar Vakinha Premiada de uma campanha
app.put('/admin/campanhas/:id/premiada', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const dados = req.body || {};
    if (!dbConectado) {
      const c = CAMPANHAS_MEM.find(x => x._id === id);
      if (!c) return res.status(404).json({ error: 'Não encontrada' });
      if (req.adminRole !== 'master' && c.owner !== req.adminUser) return res.status(403).json({ error: 'Sem permissão' });
      c.vakinhaPremiada = { ...(c.vakinhaPremiada || {}), ...dados };
      return res.json({ ok: true });
    }
    if (req.adminRole !== 'master') {
      const ex = await CampanhaModel.findById(id);
      if (!ex) return res.status(404).json({ error: 'Não encontrada' });
      if (ex.owner !== req.adminUser) return res.status(403).json({ error: 'Sem permissão' });
    }
    // Com Mixed, busca o doc atual, faz merge e salva com markModified
    const doc = await CampanhaModel.findById(id);
    if (!doc) return res.status(404).json({ error: 'Não encontrada' });
    doc.vakinhaPremiada = { ...(doc.vakinhaPremiada || {}), ...dados };
    doc.markModified('vakinhaPremiada');
    await doc.save();
    res.json({ ok: true });
  } catch (err) {
    console.error('Erro ao salvar premiada:', err.message);
    res.status(500).json({ error: 'Erro ao salvar premiada: ' + err.message });
  }
});

// Atualizar Quem Ajudou de uma campanha
app.put('/admin/campanhas/:id/quem-ajudou', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const dados = req.body || {};
    if (!dbConectado) {
      const c = CAMPANHAS_MEM.find(x => x._id === id);
      if (!c) return res.status(404).json({ error: 'Não encontrada' });
      if (req.adminRole !== 'master' && c.owner !== req.adminUser) return res.status(403).json({ error: 'Sem permissão' });
      c.quemAjudou = { ...(c.quemAjudou || {}), ...dados };
      return res.json({ ok: true });
    }
    if (req.adminRole !== 'master') {
      const ex = await CampanhaModel.findById(id);
      if (!ex) return res.status(404).json({ error: 'Não encontrada' });
      if (ex.owner !== req.adminUser) return res.status(403).json({ error: 'Sem permissão' });
    }
    const doc = await CampanhaModel.findById(id);
    if (!doc) return res.status(404).json({ error: 'Não encontrada' });
    doc.quemAjudou = { ...(doc.quemAjudou || {}), ...dados };
    doc.markModified('quemAjudou');
    await doc.save();
    res.json({ ok: true });
  } catch (err) {
    console.error('Erro ao salvar quemAjudou:', err.message);
    res.status(500).json({ error: 'Erro ao salvar: ' + err.message });
  }
});

// Excluir
app.delete('/admin/campanhas/:id', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    if (!dbConectado) {
      if (req.adminRole !== 'master') {
        const c = CAMPANHAS_MEM.find(x => x._id === id);
        if (c && c.owner !== req.adminUser) return res.status(403).json({ error: 'Sem permissão' });
      }
      CAMPANHAS_MEM = CAMPANHAS_MEM.filter(c => c._id !== id);
      return res.json({ ok: true });
    }
    if (req.adminRole !== 'master') {
      const existing = await CampanhaModel.findById(id);
      if (existing && existing.owner !== req.adminUser) return res.status(403).json({ error: 'Sem permissão para excluir esta campanha' });
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
      const { paymentSk: _sk, ...pub } = ativa || {};
      return res.json({ campanha: pub, marketing: CONFIG.marketing });
    }
    const c = await CampanhaModel.findOne({ status: 'ativa' }).select('-paymentSk').sort({ ordemExibicao: 1, createdAt: 1 });
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
      const { paymentSk: _sk, ...pub } = c || {};
      return res.json({ campanha: c ? pub : null, marketing: CONFIG.marketing });
    }
    const c = await CampanhaModel.findOne({ slug }).select('-paymentSk');
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
          if (pag.tipo === 'coracao' && pag.campanhaId) {
            await CampanhaModel.findByIdAndUpdate(pag.campanhaId, { $inc: { coracoesBase: 1 } });
          } else if (pag.campanhaId) {
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

// ─── Histórico de pagamentos (isolado por admin) ──────────────────
app.get('/admin/pagamentos', authMiddleware, async (req, res) => {
  try {
    if (!dbConectado) return res.json({ pagamentos: [], stats: {} });
    const { campanhaId, periodo } = req.query;

    // Montar filtro de campanhas visíveis pelo admin logado
    let campanhaIds = null;
    if (req.adminRole !== 'master') {
      // Busca IDs das campanhas que pertencem a este admin
      const minhasCampanhas = await CampanhaModel.find({ owner: req.adminUser }).select('_id').lean();
      campanhaIds = minhasCampanhas.map(c => c._id);
      // Admin sem campanhas → retorna vazio
      if (!campanhaIds.length) return res.json({ pagamentos: [], stats: buildStats([]) });
    }

    // Filtro base: status confirmado pela XFlow
    const filtroStatus = { status: { $in: ['paid', 'completed', 'approved'] } };

    // Filtro por campanha específica (respeita isolamento)
    let filtro = { ...filtroStatus };
    if (campanhaId) {
      // Garante que o campanhaId pedido pertence a este admin (se comum)
      if (campanhaIds && !campanhaIds.some(id => id.toString() === campanhaId)) {
        return res.status(403).json({ error: 'Sem permissão para ver esta campanha' });
      }
      filtro.campanhaId = campanhaId;
    } else if (campanhaIds) {
      filtro.campanhaId = { $in: campanhaIds };
    }

    // Filtro de período
    if (periodo && periodo !== 'all') {
      const dias = { '7d': 7, '30d': 30, '90d': 90 }[periodo] || 30;
      filtro.createdAt = { $gte: new Date(Date.now() - dias * 86400000) };
    }

    const pagamentos = await PagamentoModel.find(filtro).sort({ createdAt: -1 }).limit(500).lean();

    // Enriquecer com nome da campanha
    const campMap = {};
    if (campanhaIds) {
      const camps = await CampanhaModel.find({ _id: { $in: campanhaIds } }).select('_id nome slug').lean();
      camps.forEach(c => { campMap[c._id.toString()] = c; });
    } else {
      const ids = [...new Set(pagamentos.map(p => p.campanhaId?.toString()).filter(Boolean))];
      if (ids.length) {
        const camps = await CampanhaModel.find({ _id: { $in: ids } }).select('_id nome slug').lean();
        camps.forEach(c => { campMap[c._id.toString()] = c; });
      }
    }
    const pagamentosEnriquecidos = pagamentos.map(p => ({
      ...p,
      campanhaNome: campMap[p.campanhaId?.toString()]?.nome || null,
      campanhaSlug: campMap[p.campanhaId?.toString()]?.slug || null,
    }));

    res.json({ pagamentos: pagamentosEnriquecidos, stats: buildStats(pagamentos) });
  } catch (err) {
    console.error('Erro pagamentos:', err);
    res.status(500).json({ error: 'Erro ao listar pagamentos' });
  }
});

function buildStats(pagamentos) {
  if (!pagamentos.length) return { total: 0, count: 0, ticketMedio: 0, hoje: 0, semana: 0, porDia: [] };
  const agora = Date.now();
  const inicioDia   = new Date(); inicioDia.setHours(0,0,0,0);
  const inicioSemana = new Date(agora - 7 * 86400000);
  let total = 0, hoje = 0, semana = 0;
  const porDiaMap = {};
  pagamentos.forEach(p => {
    const v = (p.amountCents || 0) / 100;
    total += v;
    const dt = new Date(p.createdAt);
    if (dt >= inicioDia) hoje += v;
    if (dt >= inicioSemana) semana += v;
    const chave = dt.toISOString().slice(0, 10);
    porDiaMap[chave] = (porDiaMap[chave] || 0) + v;
  });
  // Gera array dos últimos 30 dias (mesmo sem pagamento)
  const porDia = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date(agora - i * 86400000);
    const k = d.toISOString().slice(0, 10);
    porDia.push({ data: k, valor: +(porDiaMap[k] || 0).toFixed(2) });
  }
  return {
    total: +total.toFixed(2),
    count: pagamentos.length,
    ticketMedio: +(total / pagamentos.length).toFixed(2),
    hoje: +hoje.toFixed(2),
    semana: +semana.toFixed(2),
    porDia
  };
}

// ─── Rota Pix (criar cobrança) ────────────────────────────────────
app.post('/criar-cobranca', async (req, res) => {
  try {
    const { amountCents, donorName, campanhaId } = req.body;
    // Validação rigorosa: apenas inteiros, mínimo R$1, máximo R$10.000
    if (!amountCents || !Number.isInteger(amountCents) || amountCents < 100 || amountCents > 1000000)
      return res.status(400).json({ error: 'Valor inválido. Mínimo R$ 1,00 e máximo R$ 10.000,00' });

    // Buscar campanha para obter nome e credenciais do admin dono
    let campanhaNome = 'Doação';
    let campanhaPK = CONFIG.pagamento.pk;
    let campanhaSK = CONFIG.pagamento.sk;
    if (campanhaId) {
      if (dbConectado) {
        const c = await CampanhaModel.findById(campanhaId);
        if (c) {
          campanhaNome = c.nome;
          // Buscar credenciais do admin dono da campanha
          if (c.owner) {
            const adminDono = await AdminUserModel.findOne({ usuario: c.owner });
            if (adminDono && adminDono.paymentPk && adminDono.paymentSk) {
              campanhaPK = adminDono.paymentPk;
              campanhaSK = adminDono.paymentSk;
            }
          }
        }
      } else {
        const c = CAMPANHAS_MEM.find(x => x._id === campanhaId);
        if (c) campanhaNome = c.nome;
      }
    }

    const PK = campanhaPK;
    const SK = campanhaSK;
    if (!PK || !SK)
      return res.status(500).json({ error: 'Credenciais de pagamento não configuradas para esta campanha' });

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
    // Descobrir credenciais corretas: busca o pagamento, depois a campanha
    let PK = CONFIG.pagamento.pk;
    let SK = CONFIG.pagamento.sk;
    if (dbConectado) {
      const pag = await PagamentoModel.findOne({ chargeId: id });
      if (pag && pag.campanhaId) {
        const c = await CampanhaModel.findById(pag.campanhaId);
        // Buscar credenciais do admin dono da campanha
        if (c && c.owner) {
          const adminDono = await AdminUserModel.findOne({ usuario: c.owner });
          if (adminDono && adminDono.paymentPk && adminDono.paymentSk) {
            PK = adminDono.paymentPk;
            SK = adminDono.paymentSk;
          }
        }
      }
    }
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
          if (pag.tipo === 'coracao') {
            // Corações: incrementa só o contador de corações (não o arrecadado)
            await CampanhaModel.findByIdAndUpdate(pag.campanhaId, { $inc: { coracoesBase: 1 } });
          } else {
            await CampanhaModel.findByIdAndUpdate(pag.campanhaId, { $inc: { arrecadado: pag.amountCents / 100 } });
          }
        }
      }
    }

    res.json({ id: data.id, status: data.status, pago });
  } catch (err) {
    console.error('Erro /status-cobranca:', err);
    res.status(500).json({ error: 'Erro interno' });
  }
});

// ─── Rota: Dar coração (cobrança PIX dedicada) ────────────────────
app.post('/dar-coracao', async (req, res) => {
  try {
    const { campanhaId, donorName } = req.body;
    if (!campanhaId) return res.status(400).json({ error: 'campanhaId obrigatório' });

    // Busca campanha e valida feature ativa
    const campanha = await CampanhaModel.findById(campanhaId).lean();
    if (!campanha) return res.status(404).json({ error: 'Campanha não encontrada' });
    if (!campanha.coracaoAtivo) return res.status(403).json({ error: 'Corações não estão ativos nesta campanha' });

    const valorReais = campanha.coracaoValor || 2;
    const amountCents = Math.round(valorReais * 100);
    if (amountCents < 100) return res.status(400).json({ error: 'Valor mínimo de R$1,00' });

    // Busca credenciais do admin dono da campanha
    let PK = CONFIG.pagamento.pk;
    let SK = CONFIG.pagamento.sk;
    if (dbConectado && campanha.owner) {
      const adminDoc = await AdminUserModel.findOne({ usuario: campanha.owner });
      if (adminDoc?.paymentPk) PK = adminDoc.paymentPk;
      if (adminDoc?.paymentSk) SK = adminDoc.paymentSk;
    }
    if (!PK || !SK) return res.status(500).json({ error: 'Credenciais de pagamento não configuradas' });

    const nome = (donorName || 'Apoiador').slice(0, 60);
    const creds = Buffer.from(`${PK}:${SK}`).toString('base64');
    const response = await fetch('https://app.xflowpayments.com/api/v1/charges', {
      method: 'POST',
      headers: { 'Authorization': `Basic ${creds}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        amountCents,
        description: `Coração — ${campanha.titulo || campanha.slug || 'campanha'}`,
        customer: {
          name: nome,
          email: 'doador@vakinha.com.br',
          document: '00000000000'
        },
        external_reference: `coracao-${Date.now()}`
      })
    });
    const data = await response.json();
    if (!response.ok) {
      console.error('XFlow /dar-coracao erro:', JSON.stringify(data));
      return res.status(502).json({ error: 'Erro ao criar cobrança' });
    }
    console.log('XFlow /dar-coracao resposta:', JSON.stringify(data).slice(0, 500));

    // Salvar no histórico com tipo='coracao'
    if (dbConectado) {
      await PagamentoModel.create({
        campanhaId: campanha._id,
        chargeId: data.id,
        amountCents,
        tipo: 'coracao',
        status: 'pending'
      });
    }

    // Extrai QR de qualquer estrutura que a XFlow retorne
    const qrRaw = data.pix?.qrCodeBase64 || data.pix?.qr_code_base64 || data.qrCodeBase64 || data.qr_code_base64 || data.qrCode || '';
    const copyPasteRaw = data.pix?.copyPaste || data.pix?.copy_paste || data.copyPaste || data.copy_paste || data.pix?.qrCode || '';
    res.json({ id: data.id, qrCodeBase64: qrRaw, copyPaste: copyPasteRaw, amountCents, valorReais });
  } catch (err) {
    console.error('Erro /dar-coracao:', err);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// ─── Rota: Status cobrança coração (incrementa coracoesBase ao confirmar) ─
// Reutiliza /status-cobranca mas incrementa coracoesBase quando tipo='coracao'
// (já tratado no polling do frontend via /status-cobranca)

// ─── Static ───────────────────────────────────────────────────────
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/health', (req, res) => res.json({ status: 'ok', pk_set: !!CONFIG.pagamento.pk, db: dbConectado ? 'mongodb' : 'memory' }));

// ─── Start ────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
conectarMongo().then(() => {
  app.listen(PORT, () => console.log(`✅ Servidor na porta ${PORT} | DB: ${dbConectado ? 'MongoDB' : 'memória'} | PK: ${CONFIG.pagamento.pk ? 'OK' : 'AUSENTE'}`));
});
