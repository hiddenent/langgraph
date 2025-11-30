// Drone Light Show in Processing
//
// This sketch simulates a coordinated drone performance using
// smooth transitions between multiple formations. It renders the drones
// in 3D space with a camera tilt so the choreography is easy to follow.
//
// Usage:
//   1. Open this file in the Processing IDE.
//   2. Press the Run button to start the animation.
//   3. Press the space bar to toggle pause/resume.
//   4. Press the left/right arrow keys to manually change formations.
//
// The choreography cycles through four formations:
//   - A classic rectangular grid.
//   - A rolling wave.
//   - A heart silhouette for celebratory finales.
//   - A rising spiral to finish the routine.
//
// Written for Processing 3 or later.

final int DRONE_COUNT = 120;
final float TRANSITION_SECONDS = 6.0;
final float CAMERA_TILT = PI / 5.0;
final float CAMERA_DISTANCE = 900;
final int TRAIL_LENGTH = 18;

Drone[] drones = new Drone[DRONE_COUNT];
Keyframe[] show;

PVector[] previousTargets;
PVector[] nextTargets;
color[] previousColors;
color[] nextColors;

float transitionStart;
boolean paused = false;
int currentKeyframe = 0;

void settings() {
  size(960, 720, P3D);
  smooth(8);
}

void setup() {
  frameRate(60);
  colorMode(RGB, 255);
  initializeDrones();
  show = buildShow();
  prepareInitialTargets();
}

void draw() {
  if (!paused) {
    updateShow();
  }
  renderScene();
}

void keyPressed() {
  if (key == ' ') {
    paused = !paused;
  } else if (keyCode == RIGHT) {
    advanceKeyframe();
  } else if (keyCode == LEFT) {
    retreatKeyframe();
  }
}

void initializeDrones() {
  for (int i = 0; i < DRONE_COUNT; i++) {
    drones[i] = new Drone();
    drones[i].position = new PVector(random(-200, 200), random(-200, 200), random(-50, 150));
    drones[i].velocity = new PVector();
    drones[i].trail = new ArrayList<PVector>();
    drones[i].color = color(40, 120, 255);
  }
}

Keyframe[] buildShow() {
  return new Keyframe[] {
    new Keyframe(createGridTargets(12, 10, 45), gradient(color(60, 140, 255), color(180, 220, 255)), 1.1),
    new Keyframe(createWaveTargets(DRONE_COUNT), gradient(color(70, 255, 200), color(20, 140, 255)), 1.0),
    new Keyframe(createHeartTargets(DRONE_COUNT), gradient(color(255, 120, 160), color(255, 220, 120)), 1.4),
    new Keyframe(createSpiralTargets(DRONE_COUNT), gradient(color(200, 180, 255), color(80, 120, 255)), 1.0)
  };
}

void prepareInitialTargets() {
  previousTargets = copyTargets(show[0].targets);
  previousColors = copyColors(show[0].colors);
  nextTargets = copyTargets(show[0].targets);
  nextColors = copyColors(show[0].colors);
  transitionStart = millis();
}

void updateShow() {
  float elapsed = (millis() - transitionStart) / 1000.0;
  float duration = TRANSITION_SECONDS * show[currentKeyframe].tempo;

  if (elapsed > duration) {
    advanceKeyframe();
    elapsed = 0;
  }

  float progress = constrain(elapsed / duration, 0, 1);
  float eased = easeInOut(progress);

  for (int i = 0; i < DRONE_COUNT; i++) {
    PVector target = PVector.lerp(previousTargets[i], nextTargets[i], eased);
    drones[i].update(target);
    color blended = lerpColor(previousColors[i], nextColors[i], eased);
    drones[i].color = blended;
  }
}

void renderScene() {
  background(6, 12, 26);
  lights();

  pushMatrix();
  translate(width / 2.0, height / 2.0, -CAMERA_DISTANCE);
  rotateX(CAMERA_TILT);

  for (Drone drone : drones) {
    drone.drawTrail();
  }
  for (Drone drone : drones) {
    drone.drawBody();
  }
  popMatrix();

  drawHUD();
}

void drawHUD() {
  hint(DISABLE_DEPTH_TEST);
  camera();
  noLights();

  fill(255, 230);
  textAlign(LEFT, TOP);
  textSize(16);
  String message = "Drone Light Show  •  Formation " + (currentKeyframe + 1) + " / " + show.length;
  text(message, 18, 16);
  textSize(12);
  text("Space: pause/resume    ←/→: change formation", 18, 36);

  hint(ENABLE_DEPTH_TEST);
}

void advanceKeyframe() {
  currentKeyframe = (currentKeyframe + 1) % show.length;
  beginTransition();
}

void retreatKeyframe() {
  currentKeyframe = (currentKeyframe - 1 + show.length) % show.length;
  beginTransition();
}

void beginTransition() {
  previousTargets = copyTargets(nextTargets);
  previousColors = copyColors(nextColors);
  nextTargets = copyTargets(show[currentKeyframe].targets);
  nextColors = copyColors(show[currentKeyframe].colors);
  transitionStart = millis();
}

float easeInOut(float t) {
  return t * t * (3 - 2 * t);
}

PVector[] copyTargets(PVector[] source) {
  PVector[] result = new PVector[source.length];
  for (int i = 0; i < source.length; i++) {
    result[i] = source[i].copy();
  }
  return result;
}

color[] copyColors(color[] source) {
  color[] result = new color[source.length];
  arrayCopy(source, result);
  return result;
}

color[] gradient(color start, color end) {
  color[] colors = new color[DRONE_COUNT];
  for (int i = 0; i < DRONE_COUNT; i++) {
    float t = i / max(1.0, DRONE_COUNT - 1.0);
    colors[i] = lerpColor(start, end, t);
  }
  return colors;
}

PVector[] createGridTargets(int cols, int rows, float spacing) {
  PVector[] targets = new PVector[DRONE_COUNT];
  int index = 0;
  float offsetX = (cols - 1) * spacing / 2.0;
  float offsetY = (rows - 1) * spacing / 2.0;

  for (int y = 0; y < rows && index < DRONE_COUNT; y++) {
    for (int x = 0; x < cols && index < DRONE_COUNT; x++) {
      float px = x * spacing - offsetX;
      float py = y * spacing - offsetY;
      targets[index++] = new PVector(px, py, 0);
    }
  }
  while (index < DRONE_COUNT) {
    targets[index] = targets[index - 1].copy();
    index++;
  }
  return targets;
}

PVector[] createWaveTargets(int count) {
  PVector[] targets = new PVector[count];
  float spacing = 18;
  for (int i = 0; i < count; i++) {
    float x = (i - count / 2.0) * spacing;
    float z = map(i, 0, count - 1, -150, 150);
    float y = 120 * sin(TWO_PI * i / (count / 3.0));
    targets[i] = new PVector(x, y, z);
  }
  return targets;
}

PVector[] createHeartTargets(int count) {
  PVector[] targets = new PVector[count];
  float scale = 220;
  for (int i = 0; i < count; i++) {
    float t = map(i, 0, count - 1, 0, TWO_PI);
    float x = scale * 16 * pow(sin(t), 3) / 16.0;
    float y = -scale * (13 * cos(t) - 5 * cos(2 * t) - 2 * cos(3 * t) - cos(4 * t)) / 16.0;
    float z = map(sin(t * 2.5), -1, 1, -90, 90);
    targets[i] = new PVector(x, y, z);
  }
  return targets;
}

PVector[] createSpiralTargets(int count) {
  PVector[] targets = new PVector[count];
  float turns = 3.0;
  float height = 420;
  float radius = 220;
  for (int i = 0; i < count; i++) {
    float t = i / max(1.0, count - 1.0);
    float angle = TWO_PI * turns * t;
    float r = radius * (0.2 + 0.8 * t);
    float x = cos(angle) * r;
    float y = map(t, 0, 1, -height / 2.0, height / 2.0);
    float z = sin(angle) * r;
    targets[i] = new PVector(x, y, z);
  }
  return targets;
}

class Drone {
  PVector position;
  PVector velocity;
  ArrayList<PVector> trail;
  color color;

  void update(PVector target) {
    PVector desired = PVector.sub(target, position);
    desired.mult(0.08);
    velocity.add(desired);
    velocity.mult(0.90);
    position.add(velocity);

    trail.add(0, position.copy());
    while (trail.size() > TRAIL_LENGTH) {
      trail.remove(trail.size() - 1);
    }
  }

  void drawBody() {
    pushMatrix();
    translate(position.x, position.y, position.z);
    noStroke();
    emissive(color);
    fill(color, 240);
    sphereDetail(6);
    sphere(9);
    popMatrix();
  }

  void drawTrail() {
    noFill();
    beginShape();
    for (int i = 0; i < trail.size(); i++) {
      float alpha = map(i, 0, trail.size(), 255, 0);
      stroke(red(color), green(color), blue(color), alpha);
      PVector p = trail.get(i);
      vertex(p.x, p.y, p.z);
    }
    endShape();
  }
}

class Keyframe {
  PVector[] targets;
  color[] colors;
  float tempo;

  Keyframe(PVector[] targets, color[] colors, float tempo) {
    this.targets = targets;
    this.colors = colors;
    this.tempo = tempo;
  }
}
