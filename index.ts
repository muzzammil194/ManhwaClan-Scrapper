import express, { Request, Response, NextFunction } from 'express';
import axios from 'axios';
import * as cheerio from 'cheerio';
import cors from 'cors';
import { connectDB } from './connection/db';
import { Manga, IManga } from './schema/manga';
import path from 'path';
import fs from 'fs';
import cloudinary from 'cloudinary';

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());

cloudinary.v2.config({
  cloud_name: "db7bunnyq",
  api_key: "936332415326756",
  api_secret: "qbPfus3ZhPsST3yHoFwh3jE7rnk",
});

app.use(cors());
connectDB();

class ERROR_FOUND extends Error {
  statusCode: number;
  constructor (message: string, statusCode: number) {
    super(message);
    this.statusCode = statusCode;
  }
}

const Handler = (err: ERROR_FOUND, req: Request, res: Response, next: NextFunction) => {
  console.error(err.stack);
  res.status(err.statusCode || 500).json({
    error: {
      message: err.message,
      statusCode: err.statusCode || 500,
    },
  });
};

const userAgents = [ // umm yea don't ask
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.77 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.77 Safari/537.36',
];

const Custom_headers = () => ({ // yay more headers... why me
  'User-Agent': userAgents[Math.floor(Math.random() * userAgents.length)],
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Referer': 'https://manhwaclan.com/',
  'Connection': 'keep-alive',
  'Upgrade-Insecure-Requests': '1',
});

//const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function fetchImages(title: string, chapter: string): Promise<string[]> {
  const url = `https://manhwaclan.com/manga/${encodeURIComponent(title)}/chapter-${chapter}/`;
  try {
    const { data } = await axios.get(url, { headers: Custom_headers() });
    const $ = cheerio.load(data);

    const imageUrls: string[] = [];
    $('.page-break img').each((index, element) => {
      const imageUrl = $(element).attr('src');
      if (imageUrl) {
        imageUrls.push(imageUrl.trim());
      }
    });

    // if (imageUrls.length === 0) {
    //   throw new ERROR_FOUND('No images found for the chapter.', 404);
    // }
    return imageUrls;
  } catch (error) {
    console.log("fetchImages", error);
    if (axios.isAxiosError(error)) {
      throw new ERROR_FOUND(`Failed to fetch images: ${error.response?.statusText || error.message}`, error.response?.status || 500);
    } else {
      throw new ERROR_FOUND('An unexpected error occurred while fetching the images.', 500);
    }
  }
}

async function fetchImageUrl(imageUrl: string): Promise<Buffer> {
  try {
    //await delay(2000);
    const response = await axios.get(imageUrl, {
      headers: Custom_headers(),
      responseType: 'arraybuffer',
    });
    return response.data;
  } catch (error) {
    if (axios.isAxiosError(error)) {
      throw new ERROR_FOUND(`Failed to fetch image: ${error.response?.statusText || error.message}`, error.response?.status || 500);
    } else {
      throw new ERROR_FOUND('An unexpected error occurred while fetching the image.', 500);
    }
  }
}

async function uploadImageFromUrl(imageUrl: string): Promise<string | null> {
  if (!imageUrl) {
    throw new Error('Image URL is required.');
  }

  try {
    // Fetch the image from the URL
    const response = await axios.get(imageUrl, { responseType: 'arraybuffer' });
    const imageBuffer = Buffer.from(response.data, 'binary');

    // Upload to Cloudinary
    const result = await new Promise<cloudinary.UploadApiResponse>((resolve, reject) => {
      const stream = cloudinary.v2.uploader.upload_stream(
        { resource_type: 'auto' },
        (error:any, result:any) => {
          if (error) {
            reject(new Error('Error uploading to Cloudinary.'));
          } else {
            resolve(result as any);
          }
        }
      );

      // Stream the image buffer to Cloudinary
      stream.end(imageBuffer);
    });

    return result.secure_url; // Return the Cloudinary URL
  } catch (error) {
    console.error(error);
    throw new Error('Error processing image.');
  }
}

async function fetchDetails(title: string) {
  const cleanedTitle = title.replace(/-/g, ' ');
  let manga = await Manga.findOne({ mangaTitle: cleanedTitle });
  if (manga) {
    console.log('Fetching from MongoDB');
    return manga;
  }

  console.log(encodeURIComponent(title));

  const url = `https://manhwaclan.com/manga/${encodeURIComponent(title)}/`;

  try {
    const { data } = await axios.get(url, { headers: Custom_headers() });
    const $ = cheerio.load(data);

    const mangaTitle = $('.post-title h1').text().trim();
    const summary = $('.summary_content .post-content p').text().trim() || 'No summary available';
    const imageUrl = $('.summary_image img').attr('src') || 'default-image-url';
    const rating = $('.post-total-rating .score').text().trim();
    const rank = $('.post-content_item:contains("Rank") .summary-content').text().trim();
    const alternative = $('.post-content_item:contains("Alternative") .summary-content').text().trim() || 'No alternative titles';
    const genres = $('.genres-content a')
      .map((i, el) => $(el).text().trim())
      .get();
    const type = $('.post-content_item:contains("Type") .summary-content').text().trim();
    const status = $('.post-content_item:contains("Status") .summary-content').text().trim();
    const chapter = $('.wp-manga-chapter').length;
    // console.log(imageUrl);

    if (!mangaTitle) {
      throw new ERROR_FOUND('Manga/Manhwa details not found.', 404);
    }

    const image = await uploadImageFromUrl(imageUrl);

    const chapters = await scrapeChapters(encodeURIComponent(title));
    if (manga) {
    console.log('Manga already exists. Updating existing record.');
    await Manga.updateOne(
      { mangaTitle },
      {
        $set: {
          summary,
          imageUrl,
          rating,
          rank,
          alternative,
          genres,
          type,
          status,
          chapters,
          chapter,
          availability: true,  // by default is true when API implement on dashboard then uses this  
        },
      }
    );
    } else {
      console.log('Inserting new manga record');
      const newManga = new Manga({
        mangaTitle,
        summary,
        imageUrl: image,
        rating,
        rank,
        alternative,
        genres,
        type,
        status,
        chapters,
        chapter,
        availability: true, // by default is true when API implement on dashboard then uses this 
      });
      await newManga.save();
    }
    return {
      mangaTitle,
      summary,
      imageUrl: image,
      rating,
      rank,
      alternative,
      genres,
      type,
      status,
      chapter,
      chapters,
    };
  } catch (error) {
    console.log(error);
    if (axios.isAxiosError(error)) {
      throw new ERROR_FOUND(`Failed to fetch image: ${error.response?.statusText || error.message}`, error.response?.status || 500);
    } else {
      console.log(error);
      throw new ERROR_FOUND('An unexpected error occurred while fetching the image.', 500);
    }
  }
}

const scrapeChapters = async (title: string) => {
  const url = `https://manhwaclan.com/manga/${encodeURIComponent(title)}/`;
  try {
    const { data } = await axios.get(url, { headers: Custom_headers() });
    const $ = cheerio.load(data);
    const chapters: any = [];

    const chapterPromises = $('.listing-chapters_wrap li.wp-manga-chapter').map(async (index, element) => {
      const chapterNo = $(element).find('a').text().trim();
      const label = $(element).find('.c-new-tag').length ? 'new' : undefined;
      const images = await fetchImages(decodeURIComponent(title), chapterNo.replace('Chapter ', ''));
      chapters.push({ chapterNo, label, images });
    }).get();
    await Promise.all(chapterPromises);
    return chapters;
  } catch (error) {
    console.log(error);
    if (axios.isAxiosError(error)) {

      throw new ERROR_FOUND(`Failed to fetch image: ${error.response?.statusText || error.message}`, error.response?.status || 500);
    } else {
      throw new ERROR_FOUND('An unexpected error occurred while fetching the image.', 500);
    }
  }
};

const getOrUpdateChapters = async (title: string, status: number) => {
  const cleanedTitle = title.replace(/-/g, ' ');
  const manga = await Manga.findOne({ mangaTitle: cleanedTitle });
  try {
    if (manga && status === 1) {
      console.log('Updating chapters');
      const newChapters = await scrapeChapters(title);

      // Update the chapters and save
      manga.chapters = newChapters;
      await manga.save();

      return manga;
    } else {
      console.log('Manga not found, fetching new data.');
      return fetchDetails(title);
    }
  } catch (error) {
    if (axios.isAxiosError(error)) {
      console.log(error);
      throw new ERROR_FOUND(`Failed to fetch image: ${error.response?.statusText || error.message}`, error.response?.status || 500);
    } else {
      console.log(error);
      throw new ERROR_FOUND('An unexpected error occurred while fetching the image.', 500);
    }
  }
};

async function getSelectedMangaFields() {
  try {
    const mangas = await Manga.aggregate([
      {
        $match: {
          availability: true,
        }
      },
      {
        $project: {
          mangaTitle: 1,
          imageUrl: 1,
          type: 1,
          chapters: {
            $filter: {
              input: '$chapters',
              as: 'chapter',
              cond: { $eq: ['$$chapter.status', true] }
            }
          }
        }
      }
    ]);
    return mangas;
  } catch (error) {
    console.error('Error fetching selected manga fields:', error);
    throw new Error('Error fetching selected manga fields');
  }
}

async function search(query: string) {
  const url = `https://manhwaclan.com/?s=${encodeURIComponent(query)}&post_type=wp-manga`;
  try {
    const { data } = await axios.get(url, { headers: Custom_headers() });
    const $ = cheerio.load(data);

    const results: { title: string, url: string, apiUrl: string }[] = [];
    $('.c-tabs-item__content').each((index, element) => {
      const title = $(element).find('.post-title').text().trim();
      const resultUrl = $(element).find('a').attr('href');
      if (title && resultUrl) {
        results.push({
          title,
          url: resultUrl,
          apiUrl: `https://manhwa-clan.vercel.app/api/${encodeURIComponent(title.toLowerCase().replace(/\s+/g, '-'))}/details`,
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

async function updateChapterStatus(mangaTitle: string, mangaStatus: boolean, chapterNo: string, status: boolean) {
  try {
    const cleanedTitle = mangaTitle.replace(/-/g, ' ');
    console.log(cleanedTitle);
    const result = await Manga.updateOne(
      { mangaTitle: cleanedTitle, 'chapters.chapterNo': chapterNo },
      {
        $set: {
          'chapters.$.status': status,
          'availability': mangaStatus,
        },
      }
    );
    if (result.modifiedCount === 0) {
      throw new Error('No matching chapter found or status already set');
    }
    console.log(`Chapter ${chapterNo} status updated to ${status} in ${mangaTitle}`);
    return result;
  } catch (error) {
    console.error('Error updating chapter status:', error);
    return error;
    throw new Error('Error updating chapter status');
  }
}

async function updateMultipleChapterStatuses(mangaTitle: string, mangaStatus: boolean, chaptersToUpdate: { chapterNo: string, status: boolean }[]) {
  try {
    for (const { chapterNo, status } of chaptersToUpdate) {
      await updateChapterStatus(mangaTitle, mangaStatus, chapterNo, status);
    }
    console.log(`Updated statuses for all specified chapters in ${mangaTitle}`);
    return `Updated statuses for all specified chapters in ${mangaTitle}`;
  } catch (error) {
    console.error('Error updating multiple chapters:', error);
  }
}

app.get('/api/:name/:chapter/images', async (req: Request, res: Response, next: NextFunction) => {
  const { name, chapter } = req.params;

  try {
    const images = await fetchImages(decodeURIComponent(name), chapter);
    res.json({ images });
  } catch (error) {
    next(error);
  }
});
// cool new endpoint...
app.get('/api/image', async (req: Request, res: Response, next: NextFunction) => {
  const { url } = req.query;

  if (!url) {
    return res.status(400).json({ error: 'Image URL is required' });
  }

  try {
    const imageData = await fetchImageUrl(url as string);
    res.set('Content-Type', 'image/jpeg');
    res.send(imageData);
  } catch (error) {
    next(error);
  }
});

// This API to get detail or if data not available to save on mongodb
app.get('/api/:name/details', async (req: Request, res: Response, next: NextFunction) => {
  const { name } = req.params;
  try {
    // const details = await getManga(name);
    console.log(decodeURIComponent(name), name);
    const details = await fetchDetails(decodeURIComponent(name));
    res.json(details);
  } catch (error) {
    next(error);
  }
});

// this API show data on frontend first Page
app.get('/api/mangas', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const mangas = await getSelectedMangaFields();
    res.json(mangas);
  } catch (error) {
    next(error);
  }
});

// This API to get latest chapters update
app.get('/api/:name/update-chapters', async (req: Request, res: Response, next: NextFunction) => {
  const { name } = req.params;
  const status = req.query.status as unknown as number;
  try {
    const details = await getOrUpdateChapters(decodeURIComponent(name), status);
    res.json(details);
  } catch (error) {
    next(error);
  }
});

// This API uses in CMS/Dashboard to send the title of manahwa or chapter no with status status true to show on frontend otherwise not show
app.post('/api/:name/chapter-status', async (req: Request, res: Response, next: NextFunction) => {
  const { name } = req.params;
  const chaptersToUpdate = req.body.chaptersToUpdate;
  const boolParam: string | undefined = req.query.isActive as string;

  const isActive = boolParam === 'true';
  try {
    if (!chaptersToUpdate || !Array.isArray(chaptersToUpdate)) {
      throw new Error('Invalid or missing chaptersToUpdate in request body');
    }

    const details = await updateMultipleChapterStatuses(name, isActive, chaptersToUpdate);
    res.json({ message: details });
  } catch (error) {
    console.log(error);
    next(error);
  }
});

app.get('/api/:name/chapters', async (req: Request, res: Response, next: NextFunction) => {
  const { name } = req.params;
  try {
    const details = await scrapeChapters(decodeURIComponent(name));
    res.json(details);
  } catch (error) {
    next(error);
  }
});

app.get('/api/search/:query', async (req: Request, res: Response, next: NextFunction) => {
  const { query } = req.params;

  try {
    const results = await search(decodeURIComponent(query));
    res.json({ results });
  } catch (error) {
    next(error);
  }
});

app.get('/api/:name/:chapter/imagesDB', async (req: Request, res: Response, next: NextFunction) => {
  const { name, chapter } = req.params;
  try {
    const cleanedTitle = name.replace(/-/g, ' ');
    const cleanedChapter = chapter.replace(/-/g, ' ');
    let manga = await Manga.findOne({ mangaTitle: cleanedTitle });
    if (manga) {
      const mangaChapter = manga.chapters.find((ch: any) => ch.chapterNo === cleanedChapter);
      if (mangaChapter && mangaChapter.images) {
        res.json(mangaChapter.images);
      } else {
        res.status(404).json({ message: 'Chapter not found or no images available' });
      }
    } else {
      res.status(404).json({ message: 'Manga not found' });
    }
  } catch (error) {
    next(error);
  }
});


app.use(Handler);

app.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`);
});
