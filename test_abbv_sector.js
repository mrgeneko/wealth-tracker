const req = require('yahoo-finance2');
const YahooFinance = (req && req.default) ? req.default : req;
const yf = new YahooFinance();

async function test() {
  try {
    const data = await yf.quoteSummary('ABBV', {
      modules: ['price', 'assetProfile', 'summaryProfile', 'summaryDetail']
    });
    
    console.log('assetProfile.sector:', data.assetProfile?.sector);
    console.log('summaryProfile.sector:', data.summaryProfile?.sector);
    console.log('summaryDetail.sector:', data.summaryDetail?.sector);
    console.log('price.sector:', data.price?.sector);
  } catch (e) {
    console.error('Error:', e.message);
  }
}

test();
