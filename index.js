import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import fetch from 'node-fetch';
import TelegramBot from 'node-telegram-bot-api';

dotenv.config();
const app = express();
app.use(cors());
const PORT = process.env.PORT || 3000;

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_API_ID = process.env.TELEGRAM_API_ID;
const TELEGRAM_API_HASH = process.env.TELEGRAM_API_HASH;
if (!TELEGRAM_BOT_TOKEN) {
  console.error('Missing TELEGRAM_BOT_TOKEN');
  process.exit(1);
}

const bot = new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: false });

// Static ID-to-date mapping for fallback
const ID_DATE_MAPPING = [
  { id: 1n, date: new Date('2013-08-01') }, // Telegram launched Aug 2013
  { id: 1000000n, date: new Date('2014-01-01') },
  { id: 10000000n, date: new Date('2014-06-01') },
  { id: 50000000n, date: new Date('2015-01-01') },
  { id: 100000000n, date: new Date('2015-06-01') },
  { id: 500000000n, date: new Date('2016-01-01') },
  { id: 1000000000n, date: new Date('2016-06-01') },
  { id: 2000000000n, date: new Date('2017-01-01') },
  { id: 5000000000n, date: new Date('2018-01-01') },
  { id: 10000000000n, date: new Date('2019-01-01') },
  { id: 20000000000n, date: new Date('2020-01-01') },
  { id: 50000000000n, date: new Date('2021-01-01') },
  { id: 100000000000n, date: new Date('2022-01-01') },
  { id: 200000000000n, date: new Date('2023-01-01') },
  { id: 500000000000n, date: new Date('2024-01-01') },
  { id: BigInt(Number.MAX_SAFE_INTEGER), date: new Date('2025-07-18') }
];

// Helper function to calculate date range from accuracy
function calculateDateRange(date, accuracy) {
  const baseDate = new Date(date);
  let monthsToAdd = 0;
  
  if (accuracy.includes('3 months')) {
    monthsToAdd = 3;
  } else if (accuracy.includes('6 months')) {
    monthsToAdd = 6;
  } else if (accuracy.includes('12 months')) {
    monthsToAdd = 12;
  }

  const startDate = new Date(baseDate);
  startDate.setMonth(baseDate.getMonth() - monthsToAdd);
  
  const endDate = new Date(baseDate);
  endDate.setMonth(baseDate.getMonth() + monthsToAdd);

  return {
    start: formatDate(startDate),
    end: formatDate(endDate)
  };
}

// TelegramAgeEstimator class
class TelegramAgeEstimator {
  static estimateFromUserId(userId) {
    try {
      const id = BigInt(userId);
      const currentDate = new Date('2025-07-18'); // Cap at current date
      for (let i = 0; i < ID_DATE_MAPPING.length - 1; i++) {
        if (id >= ID_DATE_MAPPING[i].id && id < ID_DATE_MAPPING[i + 1].id) {
          const startDate = ID_DATE_MAPPING[i].date;
          const endDate = ID_DATE_MAPPING[i + 1].date;
          const idRange = Number(ID_DATE_MAPPING[i + 1].id - ID_DATE_MAPPING[i].id);
          const timeRange = endDate.getTime() - startDate.getTime();
          const idDiff = Number(id - ID_DATE_MAPPING[i].id);
          const interpolatedTime = startDate.getTime() + (idDiff / idRange) * timeRange;
          const estimatedDate = new Date(interpolatedTime);
          return estimatedDate > currentDate ? currentDate : estimatedDate;
        }
      }
      return new Date();
    } catch (err) {
      console.error('Error estimating date from user ID:', err);
      return null;
    }
  }

  static estimateFromUsername(username) {
    if (!username) return null;
    const patterns = [
      { regex: /^user\d{7,9}$/, dateRange: new Date('2013-08-01') },
      { regex: /^[a-z]{3,8}\d{2,4}$/, dateRange: new Date('2014-06-01') },
      { regex: /^\w{3,8}$/, dateRange: new Date('2015-06-01') },
      { regex: /^.{1,8}$/, dateRange: new Date('2016-01-01') },
    ];
    for (const pattern of patterns) {
      if (pattern.regex.test(username.replace('@', ''))) {
        return pattern.dateRange;
      }
    }
    return null;
  }

  static estimateAccountAge(userId, username) {
    const estimates = [];
    const confidence = { low: 1, medium: 2, high: 3 };
    const userIdEst = this.estimateFromUserId(userId);
    if (userIdEst && userId !== '0') {
      estimates.push({ 
        date: userIdEst, 
        confidence: confidence.high, 
        method: 'User ID Analysis' 
      });
    }
    const usernameEst = this.estimateFromUsername(username);
    if (usernameEst) {
      estimates.push({ 
        date: usernameEst, 
        confidence: confidence.medium, 
        method: 'Username Pattern' 
      });
    }
    if (estimates.length === 0) {
      return {
        estimatedDate: new Date(),
        confidence: 'very_low',
        method: 'Default',
        accuracy: '±12 months',
        dateRange: calculateDateRange(new Date(), '±12 months')
      };
    }
    const weightedSum = estimates.reduce((sum, est) => sum + (est.date.getTime() * est.confidence), 0);
    const totalWeight = estimates.reduce((sum, est) => sum + est.confidence, 0);
    const finalDate = new Date(weightedSum / totalWeight);
    const maxConfidence = Math.max(...estimates.map(e => e.confidence));
    const confidenceLevel = maxConfidence === 3 ? 'high' : maxConfidence === 2 ? 'medium' : 'low';
    const primaryMethod = estimates.find(e => e.confidence === maxConfidence)?.method || 'Combined';
    const accuracy = confidenceLevel === 'high' ? '±3 months' : 
                     confidenceLevel === 'medium' ? '±6 months' : '±12 months';
    return {
      estimatedDate: finalDate,
      confidence: confidenceLevel,
      method: primaryMethod,
      accuracy,
      dateRange: calculateDateRange(finalDate, accuracy),
      allEstimates: estimates
    };
  }
}

// Helper functions
function formatDate(date) {
  const options = { year: 'numeric', month: 'long', day: 'numeric' };
  return date.toLocaleDateString('en-US', options);
}

function calculateAge(createdDate) {
  const now = new Date();
  const created = new Date(createdDate);
  const diffTime = Math.abs(now - created);
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  const diffMonths = Math.floor(diffDays / 30);
  const diffYears = Math.floor(diffMonths / 12);
  if (diffYears > 0) {
    const remainingMonths = diffMonths % 12;
    return `${diffYears} year${diffYears > 1 ? 's' : ''}${remainingMonths > 0 ? ` and ${remainingMonths} month${remainingMonths > 1 ? 's' : ''}` : ''}`;
  } else if (diffMonths > 0) {
    return `${diffMonths} month${diffMonths > 1 ? 's' : ''}`;
  } else {
    return `${diffDays} day${diffDays > 1 ? 's' : ''}`;
  }
}

app.get('/', (req, res) => {
  res.setHeader('X-Powered-By', 'TelegramAgeChecker');
  res.send('Telegram Account Age Checker API is running');
});

app.get('/api/user/:username', async (req, res) => {
  const username = req.params.username.replace('@', '');

  try {
    await new Promise(resolve => setTimeout(resolve, 1000)); // Avoid rate limits

    // Try Telegram Bot API
    console.log(`Attempting Telegram Bot API for username: ${username}`);
    let user, photos;
    try {
      user = await bot.getChat(`@${username}`);
      console.log('Telegram Bot API Response (getChat):', JSON.stringify(user, null, 2));
      if (user.id) {
        photos = await bot.getUserProfilePhotos(user.id);
        console.log('Telegram Bot API Response (getUserProfilePhotos):', JSON.stringify(photos, null, 2));
      }
    } catch (error) {
      console.log(`Telegram Bot API failed: ${error.message}`);
      user = null;
    }

    let avatarUrl = '';
    if (photos && photos.total_count > 0) {
      const fileId = photos.photos[0][0].file_id;
      try {
        const file = await bot.getFile(fileId);
        avatarUrl = `https://api.telegram.org/file/bot${TELEGRAM_BOT_TOKEN}/${file.file_path}`;
        console.log(`Avatar URL: ${avatarUrl}`);
      } catch (fileError) {
        console.log(`Failed to get file: ${fileError.message}`);
      }
    }

    if (user && user.id) {
      const ageEstimate = TelegramAgeEstimator.estimateAccountAge(
        user.id.toString(),
        user.username || username
      );

      const formattedDate = formatDate(ageEstimate.estimatedDate);
      const accountAge = calculateAge(ageEstimate.estimatedDate);

      res.setHeader('X-Powered-By', 'TelegramAgeChecker');
      res.json({
        username: user.username?.replace('@', '') || username,
        nickname: `${user.first_name || ''} ${user.last_name || ''}`.trim() || '',
        avatar: avatarUrl,
        followers: user.participant_count || 0,
        total_likes: 0, // Telegram doesn't provide likes
        verified: user.verified || false,
        description: user.description || user.bio || '',
        region: 'Unknown', // Telegram doesn't provide region
        user_id: user.id.toString(),
        first_name: user.first_name || '',
        last_name: user.last_name || '',
        estimated_creation_date: formattedDate,
        estimated_creation_date_range: ageEstimate.dateRange,
        account_age: accountAge,
        estimation_confidence: ageEstimate.confidence,
        estimation_method: ageEstimate.method,
        accuracy_range: ageEstimate.accuracy,
        estimation_details: {
          all_estimates: ageEstimate.allEstimates,
          note: 'This is an estimated creation date based on available data. Actual creation date may vary. This tool is not affiliated with Telegram.'
        }
      });
    } else {
      // Fallback to static estimation
      console.log(`Falling back to static estimation for username: ${username}`);
      const ageEstimate = TelegramAgeEstimator.estimateAccountAge('0', username);

      const formattedDate = formatDate(ageEstimate.estimatedDate);
      const accountAge = calculateAge(ageEstimate.estimatedDate);

      res.setHeader('X-Powered-By', 'TelegramAgeChecker');
      res.json({
        username: username,
        nickname: '',
        avatar: '',
        followers: 0,
        total_likes: 0,
        verified: false,
        description: '',
        region: 'Unknown',
        user_id: '0',
        first_name: '',
        last_name: '',
        estimated_creation_date: formattedDate,
        estimated_creation_date_range: ageEstimate.dateRange,
        account_age: accountAge,
        estimation_confidence: ageEstimate.confidence,
        estimation_method: ageEstimate.method,
        accuracy_range: ageEstimate.accuracy,
        estimation_details: {
          all_estimates: ageEstimate.allEstimates,
          note: 'This is an estimated creation date based on username pattern due to limited data. Actual creation date may vary. This tool is not affiliated with Telegram.'
        }
      });
    }
  } catch (error) {
    console.error('API Error:', error.message, error.stack);
    res.status(500).json({ 
      error: 'Failed to fetch user info from Telegram API',
      details: error.message
    });
  }
});

app.get('/health', (req, res) => {
  res.setHeader('X-Powered-By', 'TelegramAgeChecker');
  res.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
