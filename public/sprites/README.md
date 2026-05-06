# Full sprite sheets

Put full horizontal sprite sheets here:

```text
public/sprites/idle.png
public/sprites/talk.png
public/sprites/think.png
public/sprites/inspect.png
public/sprites/celebrate.png
public/sprites/confused.png
public/sprites/sleep.png
public/sprites/wake.png
```

Expected format:

```text
8 frames in one horizontal row
transparent background
same frame size for every cell
character centered in every frame
no labels, no frame borders, no background
```

Default settings assume each frame is `512x512`. If your sheet uses another cell size or frame count, edit:

```text
src/spriteManifest.ts
```

Prompt:

```text
Create a transparent PNG horizontal sprite sheet for a small alien rock-spider desktop pet. 8 equal frames in one row. Squat rounded faceted stone body, six thick segmented legs, cracked tan-brown rock texture, subtle turquoise glowing mineral patches, no eyes, no mouth, no face, heavy grounded stance, cute but realistic, soft contact shadow, consistent character position in every frame, front three-quarter view, idle breathing animation, no labels, no borders, no background.
```
