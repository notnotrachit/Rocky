export type PetAnimation =
  | "idle"
  | "talk"
  | "think"
  | "inspect"
  | "celebrate"
  | "confused"
  | "sleep"
  | "wake";

export type PetMood = "calm" | "curious" | "focused" | "excited" | "confused" | "sleepy";

export type SpriteSheet = {
  file: string;
  frames: number;
  frameWidth: number;
  frameHeight: number;
  fps: number;
  loop: boolean;
};

export const spriteManifest: Record<PetAnimation, SpriteSheet> = {
  idle: {
    file: "/sprites/idle.png",
    frames: 8,
    frameWidth: 512,
    frameHeight: 512,
    fps: 8,
    loop: true,
  },
  talk: {
    file: "/sprites/talk.png",
    frames: 8,
    frameWidth: 512,
    frameHeight: 512,
    fps: 10,
    loop: true,
  },
  think: {
    file: "/sprites/think.png",
    frames: 6,
    frameWidth: 512,
    frameHeight: 512,
    fps: 7,
    loop: true,
  },
  inspect: {
    file: "/sprites/inspect.png",
    frames: 8,
    frameWidth: 512,
    frameHeight: 512,
    fps: 8,
    loop: true,
  },
  celebrate: {
    file: "/sprites/celebrate.png",
    frames: 6,
    frameWidth: 512,
    frameHeight: 512,
    fps: 11,
    loop: true,
  },
  confused: {
    file: "/sprites/confused.png",
    frames: 6,
    frameWidth: 512,
    frameHeight: 512,
    fps: 9,
    loop: true,
  },
  sleep: {
    file: "/sprites/sleep.png",
    frames: 6,
    frameWidth: 512,
    frameHeight: 512,
    fps: 6,
    loop: false,
  },
  wake: {
    file: "/sprites/wake.png",
    frames: 6,
    frameWidth: 512,
    frameHeight: 512,
    fps: 8,
    loop: false,
  },
};
