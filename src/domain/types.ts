export type Memory = {
  id: string;
  date: string;
  time: string;
  place: string;
  lyrics: string[];
  startsAt: number;
  story: string;
  conversation: { person: string; words: string }[];
  sourceClipId?: string;
};

export type Clip = {
  id: string;
  seconds: number;
  date: string;
  time: string;
  place: string;
  memory: Memory;
};

export type Draft = {
  id: string;
  title: string;
  date: string;
  clips: Clip[];
};

export type Song = {
  id: string;
  title: string;
  trackTitle: string;
  date: string;
  contextDate: string;
  memories: Memory[];
  sourceClips: Clip[];
  duration: number;
  members?: string[];
};
