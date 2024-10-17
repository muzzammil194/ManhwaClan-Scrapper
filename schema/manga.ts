import mongoose, { Schema, Document } from 'mongoose';

interface Chapter {
  chapterNo: string;
  label: string | undefined;
  status: boolean;
  images: string[];
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
  availability: Boolean;
}

const MangaSchema: Schema = new Schema({
  mangaTitle: { type: String,required: true , unique: true },
  summary: { type: String,  },
  imageUrl: { type: String},
  rating: { type: String,  },
  rank: { type: String,  },
  alternative: { type: String,  },
  genres: [{ type: String,  }],
  type: { type: String,  },
  status: { type: String,  },
  chapters: [
    {
      chapterNo: { type: String,},
      label: { type: String },
      status: { type: Boolean },
      images: { type: [String] }
    }
  ],
  chapter: { type: Number,  },
  availability: { type: Boolean }
});

// Export the model
export const Manga = mongoose.model<IManga>('Manga', MangaSchema);
