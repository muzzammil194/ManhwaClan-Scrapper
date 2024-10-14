import mongoose, { Schema, Document } from 'mongoose';

interface Chapter {
  chapterNo: string;
  label: string | undefined;
  status: number;
}

export interface IManga extends Document {
  mangaTitle: string;
  summary: string;
  imageUrl: string;
  rating: string;
  rank: string;
  alternative: string;
  genres: string[];
  type: string;
  status: string;
  chapters: Chapter[];
  chapter: Number;
}

const MangaSchema: Schema = new Schema({
  mangaTitle: { type: String, required: true, unique: true },
  summary: { type: String, required: true },
  imageUrl: { type: String},
  rating: { type: String, required: true },
  rank: { type: String, required: true },
  alternative: { type: String, required: true },
  genres: [{ type: String, required: true }],
  type: { type: String, required: true },
  status: { type: String, required: true },
  chapters: [
    {
      chapterNo: { type: String, required: true },
      label: { type: String },
      status: { type: Number }
    }
  ],
  chapter: { type: Number, required: true }
});

// Export the model
export const Manga = mongoose.model<IManga>('Manga', MangaSchema);
