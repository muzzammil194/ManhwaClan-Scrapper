import express, { Request, Response, NextFunction } from 'express';
import axios from 'axios';
import * as cheerio from 'cheerio';

const app = express();
const port = process.env.PORT || 3000;

class ERROR_FOUND extends Error {
  statusCode: number;
  constructor(message: string, statusCode: number) {
    super(message);
    this.statusCode = statusCode;
  }
}

const Handler = (err: ERROR_FOUND, req: Request, res: Response, next: NextFunction) => {
  console.error(err.stack);
  res.status(err.statusCode || 500).json({
    error: {
      message: err.message,
      statusCode: err.statusCode || 500
    }
  });
};

async function fetchImages(title: string, chapter: string): Promise<string[]> {
  const url = `https://manhwaclan.com/manga/${title}/chapter-${chapter}/`;
  try {
    const { data } = await axios.get(url);
    const $ = cheerio.load(data);

    const imageUrls: string[] = [];
    $('.page-break img').each((index, element) => {
      const imageUrl = $(element).attr('src');
      if (imageUrl) {
        imageUrls.push(imageUrl.trim());
      }
    });

    if (imageUrls.length === 0) {
      throw new ERROR_FOUND('No images found for the chapter.', 404);
    }

    return imageUrls;
  } catch (error) {
    if (axios.isAxiosError(error)) {
      throw new ERROR_FOUND(`Failed to fetch images: ${error.response?.statusText || error.message}`, error.response?.status || 500);
    } else {
      throw new ERROR_FOUND('An unexpected error occurred while fetching the images.', 500);
    }
  }
}

async function fetchDetails(title: string) {
  const url = `https://manhwaclan.com/manga/${title}/`;
  try {
    const { data } = await axios.get(url);
    const $ = cheerio.load(data);

    const mangaTitle = $('.post-title h1').text().trim();
    const summary = $('.summary_content .post-content p').text().trim();
    const imageUrl = $('.summary_image img').attr('src');
    const rating = $('.post-total-rating .score').text().trim();
    const rank = $('.post-content_item:contains("Rank") .summary-content').text().trim();
    const alternative = $('.post-content_item:contains("Alternative") .summary-content').text().trim();
    const genres = $('.genres-content a').map((i, el) => $(el).text().trim()).get();
    const type = $('.post-content_item:contains("Type") .summary-content').text().trim();
    const status = $('.post-content_item:contains("Status") .summary-content').text().trim();

    if (!mangaTitle) {
      throw new ERROR_FOUND('Manga/Manhwa details not found.', 404);
    }

    return {
      mangaTitle,
      summary,
      imageUrl,
      rating,
      rank,
      alternative,
      genres,
      type,
      status
    };
  } catch (error) {
    if (axios.isAxiosError(error)) {
      throw new ERROR_FOUND(`Failed to fetch manga details: ${error.response?.statusText || error.message}`, error.response?.status || 500);
    } else {
      throw new ERROR_FOUND('An unexpected error occurred while fetching manga/manhwa details.', 500);
    }
  }
}

async function search(query: string) {
  const url = `https://manhwaclan.com/?s=${encodeURIComponent(query)}&post_type=wp-manga`;
  try {
    const { data } = await axios.get(url);
    const $ = cheerio.load(data);

    const results: { title: string, url: string, "url-1": string }[] = [];
    $('.c-tabs-item__content').each((index, element) => {
      const title = $(element).find('.post-title').text().trim();
      const resultUrl = $(element).find('a').attr('href');
      if (title && resultUrl) {
        results.push({ 
          title, 
          url: resultUrl, 
          "url-1": `https://manhwa-clan.vercel.app/api/${title.toLowerCase().replace(/\s+/g, '-')}/details` 
        });
      }
    });

    if (results.length === 0) {
      throw new ERROR_FOUND('No results found for the search query.', 404);
    }

    return results;
  } catch (error) {
    if (axios.isAxiosError(error)) {
      throw new ERROR_FOUND(`Failed to search manga: ${error.response?.statusText || error.message}`, error.response?.status || 500);
    } else {
      throw new ERROR_FOUND('An unexpected error occurred while searching manga/manhwa.', 500);
    }
  }
}

app.get('/api/:name/:chapter/images', async (req: Request, res: Response, next: NextFunction) => {
  const { name, chapter } = req.params;

  try {
    const images = await fetchImages(name, chapter);
    res.json({ images });
  } catch (error) {
    next(error);
  }
});

app.get('/api/:name/details', async (req: Request, res: Response, next: NextFunction) => {
  const { name } = req.params;

  try {
    const details = await fetchDetails(name);
    res.json(details);
  } catch (error) {
    next(error);
  }
});

app.get('/api/search/:query', async (req: Request, res: Response, next: NextFunction) => {
  const { query } = req.params;

  try {
    const results = await search(query);
    res.json({ results });
  } catch (error) {
    next(error);
  }
});

app.use(Handler);

app.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`);
});
