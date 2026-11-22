const express = require('express');
const cors = require('cors');
const app = express();

app.use(express.json());
app.use(cors());

const PK = process.env.PAYMENT_PK;
const SK = process.env.PAYMENT_SK;

app.post('/criar-cobranca', async (req, res) => {
  try {
    const { amountCents, donorName } = req.body;
    if (!amountCents || amountCents < 100)
      return res.status(400).json({ error: 'Valor mínimo: R$ 1,00' });

    const creds = Buffer.from(`${PK}:${SK}`).toString('base64');

    const response = await fetch('https://app.xflowpayments.com/api/v1/charges', {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${creds}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        amountCents,
        description: 'Doação — Pequena Ester (leucemia)',
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
      return res.status(response.status).json({ error: data.message || 'Erro na API' });

    res.json({
      id: data.id,
      qrCodeBase64: data.pix?.qrCodeBase64,
      copyPaste: data.pix?.copyPaste
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro interno' });
  }
});

app.get('/', (req, res) => res.json({ status: 'ok' }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));
