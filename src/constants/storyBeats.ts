import type { StoryBeat } from "../types";

export const SAVE_THE_CAT_BEATS: StoryBeat[] = [
  { id: "openingImage", label: "01 • OPENING IMAGE", placeholder: "A single visual that represents the entire story...", description: "The first impression — a snapshot of the hero before the journey" },
  { id: "themeStated", label: "02 • THEME STATED", placeholder: "Someone states the theme early on...", description: "The lesson the hero will learn by the end" },
  { id: "setup", label: "03 • SETUP", placeholder: "Show the hero in their ordinary world...", description: "Establish the hero, their world, and what's missing" },
  { id: "catalyst", label: "04 • CATALYST", placeholder: "The inciting incident that changes everything...", description: "The life-changing event that propels the hero into action" },
  { id: "debate", label: "05 • DEBATE", placeholder: "The hero questions whether to act...", description: "The hero hesitates — should they take on this challenge?" },
  { id: "breakIntoTwo", label: "06 • BREAK INTO TWO", placeholder: "The hero makes a choice and enters a new world...", description: "The hero commits to the journey" },
  { id: "bStory", label: "07 • B STORY", placeholder: "Introduce the love interest or mentor...", description: "The relationship that will help the hero grow" },
  { id: "funAndGames", label: "08 • FUN AND GAMES", placeholder: "The promise of the premise — the best parts...", description: "The hero explores the new world and faces challenges" },
  { id: "midpoint", label: "09 • MIDPOINT", placeholder: "A false victory or false defeat...", description: "The hero reaches a major turning point" },
  { id: "badGuysCloseIn", label: "10 • BAD GUYS CLOSE IN", placeholder: "The opposition gets stronger...", description: "The villain or obstacles intensify" },
  { id: "allIsLost", label: "11 • ALL IS LOST", placeholder: "The hero hits rock bottom...", description: "The worst moment — everything seems hopeless" },
  { id: "darkNight", label: "12 • DARK NIGHT OF THE SOUL", placeholder: "The hero reflects on what went wrong...", description: "The hero processes their failure and finds wisdom" },
  { id: "breakIntoThree", label: "13 • BREAK INTO THREE", placeholder: "The hero finds a solution...", description: "The hero discovers the final piece and commits to the finale" },
  { id: "finale", label: "14 • FINALE", placeholder: "The hero faces the final challenge...", description: "The climactic confrontation and resolution" },
  { id: "finalImage", label: "15 • FINAL IMAGE", placeholder: "The opposite of the opening image...", description: "Show how the hero has changed" },
];

export const STORY_PROGRESSION_LOGIC: Record<string, { minImages: number; maxImages: number; type: string; characters: number }> = {
  openingImage: { minImages: 1, maxImages: 2, type: "establishing", characters: 0 },
  themeStated: { minImages: 0, maxImages: 1, type: "abstract", characters: 0 },
  setup: { minImages: 1, maxImages: 2, type: "establishing", characters: 1 },
  catalyst: { minImages: 1, maxImages: 2, type: "action", characters: 1 },
  debate: { minImages: 0, maxImages: 1, type: "emotion", characters: 1 },
  breakIntoTwo: { minImages: 1, maxImages: 2, type: "action", characters: 1 },
  bStory: { minImages: 1, maxImages: 2, type: "dialogue", characters: 2 },
  funAndGames: { minImages: 2, maxImages: 3, type: "action", characters: 2 },
  midpoint: { minImages: 2, maxImages: 3, type: "climax", characters: 2 },
  badGuysCloseIn: { minImages: 2, maxImages: 3, type: "action", characters: 2 },
  allIsLost: { minImages: 2, maxImages: 3, type: "emotion", characters: 2 },
  darkNight: { minImages: 1, maxImages: 2, type: "emotion", characters: 1 },
  breakIntoThree: { minImages: 1, maxImages: 2, type: "action", characters: 2 },
  finale: { minImages: 3, maxImages: 4, type: "climax", characters: 3 },
  finalImage: { minImages: 1, maxImages: 2, type: "establishing", characters: 1 },
};

export function distributeReferenceImages(referenceImages: any[], _storyBeats: Record<string, string>): Record<string, any[]> {
  const distribution: Record<string, any[]> = {};
  const totalImages = referenceImages.length;
  let imageIndex = 0;
  const shuffledImages = [...referenceImages].sort(() => Math.random() - 0.5);

  SAVE_THE_CAT_BEATS.forEach((beat) => {
    const logic = STORY_PROGRESSION_LOGIC[beat.id];
    if (!logic) return;
    const numImages = Math.min(
      Math.floor(Math.random() * (logic.maxImages - logic.minImages + 1)) + logic.minImages,
      totalImages - imageIndex
    );
    if (numImages > 0 && imageIndex < totalImages) {
      distribution[beat.id] = shuffledImages.slice(imageIndex, imageIndex + numImages);
      imageIndex += numImages;
    } else {
      distribution[beat.id] = [];
    }
  });
  return distribution;
}
