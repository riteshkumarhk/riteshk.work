export const LIQUID_RADIUS = 9.5;
export const REST_FOLD = 3.85;
const TURN = Math.PI * 2;

export function liquidPoint(angle, {fold = REST_FOLD, flow = 0, strain = 0, activity = 0, lobes = [0, 0, 0, 0, 0, 0], petalFolds = null, foldWeights = [0, 1, 0, 0]} = {}) {
  const traveling = 2 * angle - flow;
  let horizontal = 0, vertical = 0;
  for (let count = 3; count <= 6; count++) {
    const contribution = foldWeights[count - 3];
    if (!contribution) continue;
    let influence = 0, localDepth = 0, totalWeight = 0;
    for (let index = 0; index < count; index++) {
      const weight = Math.pow(.5 + .5 * Math.cos(angle - index * TURN / count), 6);
      influence += weight * lobes[index];
      localDepth += weight * (petalFolds ? petalFolds[index] : fold);
      totalWeight += weight;
    }
    influence /= totalWeight;
    const restOpening = .85 * (1 - activity);
    const localFold = Math.max(0, localDepth / totalWeight - restOpening) * (1 + activity * .12 * influence);
    const petalAmount = Math.min(1, localFold / REST_FOLD);
    const envelope = 1 - activity * ((.035 + .15 * petalAmount) * (.5 - .5 * influence) + .012 * (.5 + .5 * Math.sin(traveling)));
    const radius = LIQUID_RADIUS - localFold;
    horizontal += contribution * (radius * Math.sin(angle) - localFold * Math.sin((count - 1) * angle)) * envelope;
    vertical += contribution * (-radius * Math.cos(angle) - localFold * Math.cos((count - 1) * angle)) * envelope;
  }
  const twist = activity * .024 * Math.sin(traveling) + strain * .025 * Math.sin(2 * angle - flow * .65);
  return {
    horizontal: 12 + horizontal * Math.cos(twist) - vertical * Math.sin(twist),
    vertical: 12 + horizontal * Math.sin(twist) + vertical * Math.cos(twist)
  };
}

export function ribbonPath(state = {}) {
  const segments = 96, step = TURN / segments, epsilon = .0001;
  const sample = angle => {
    const point = liquidPoint(angle, state);
    const before = liquidPoint(angle - epsilon, state), after = liquidPoint(angle + epsilon, state);
    return {...point, tangentHorizontal: (after.horizontal - before.horizontal) / (2 * epsilon), tangentVertical: (after.vertical - before.vertical) / (2 * epsilon)};
  };
  const number = value => value.toFixed(4);
  let from = sample(0);
  let path = 'M' + number(from.horizontal) + ' ' + number(from.vertical);
  for (let index = 1; index <= segments; index++) {
    const to = sample(index * step);
    path += 'C' + [from.horizontal + from.tangentHorizontal * step / 3, from.vertical + from.tangentVertical * step / 3, to.horizontal - to.tangentHorizontal * step / 3, to.vertical - to.tangentVertical * step / 3, to.horizontal, to.vertical].map(number).join(' ');
    from = to;
  }
  return path + 'Z';
}

export function createMotion() {
  let elapsed = 0, breath = 0, flow = 0, fold = REST_FOLD, angle = 0, speed = 0, strain = 0, activity = 0;
  let previousPhase = 'idle', restAngle = 0;
  const petalFolds = Array(6).fill(REST_FOLD);
  const counts = [4, 3, 5, 6, 4, 6, 3, 5];
  return {
    step(seconds, phase, reduced = false) {
      if (reduced) return {fold: REST_FOLD, flow: 0, strain: 0, angle: 0, speed: 0, activity: 0, lobes: [0, 0, 0, 0]};
      const duration = Math.max(0, Math.min(seconds, .05));
      const active = phase !== 'idle';
      activity += ((active ? 1 : 0) - activity) * -Math.expm1(-duration / (active ? .35 : .65));
      if (!active && activity < .001) activity = 0;
      elapsed += duration * activity;
      breath += duration * activity * TURN / 6 * (1 + .16 * Math.sin(elapsed * .37) + .1 * Math.sin(elapsed * .71));
      flow += duration * activity * .8;
      const foldedDepth = REST_FOLD * (.94 + .105 * Math.sin(breath * .173 + .7) + .055 * Math.sin(breath * .271 + 1.3));
      const openDepth = .025 + .2 * (.5 + .5 * Math.sin(breath * .219 + .6));
      const breathingFold = openDepth + (foldedDepth - openDepth) * (.5 + .5 * Math.cos(breath));
      const targetFold = REST_FOLD + activity * (breathingFold - REST_FOLD);
      fold += (targetFold - fold) * -Math.expm1(-duration / .16);
      if (!active && activity === 0) fold = REST_FOLD;
      for (let index = 0; index < 6; index++) {
        const offset = (index - 1.5) * .28 + .34 * Math.sin(elapsed * (.19 + index * .037) + index * 2.1);
        const petalDepth = openDepth + (foldedDepth - openDepth) * (.5 + .5 * Math.cos(breath + offset));
        const target = REST_FOLD + activity * (petalDepth - REST_FOLD);
        petalFolds[index] += (target - petalFolds[index]) * -Math.expm1(-duration / (.16 + index * .025));
        if (!active && activity === 0) petalFolds[index] = REST_FOLD;
      }
      const targetSpeed = phase === 'answering' ? TURN / 3 * (1 - .38 * Math.cos(TURN * elapsed / 3)) : 0;
      if (!active) {
        if (previousPhase !== 'idle') restAngle = Math.round((angle + speed * .2) / TURN) * TURN;
        speed += (-10 * speed - 25 * (angle - restAngle)) * duration;
      } else speed += (targetSpeed - speed) * -Math.expm1(-duration / .48);
      angle += speed * duration;
      strain += (speed / (TURN / 3) - strain) * -Math.expm1(-duration / .6);
      if (!active && activity === 0) {speed = 0; strain = 0; angle = 0; restAngle = 0;}
      previousPhase = phase;
      const cycle = Math.floor(breath / TURN), position = breath % TURN;
      const progress = Math.max(0, Math.min(1, (position - Math.PI + .6) / 1.2));
      const mix = progress * progress * (3 - 2 * progress);
      const foldWeights = [0, 1 - activity, 0, 0];
      foldWeights[counts[cycle % counts.length] - 3] += activity * (1 - mix);
      foldWeights[counts[(cycle + 1) % counts.length] - 3] += activity * mix;
      const lobes = Array.from({length: 6}, (_, index) => .62 * Math.sin(elapsed * (.43 + index * .083) + index * 1.9) + .38 * Math.sin(elapsed * (.79 + index * .057) - index * 1.3));
      return {fold, flow, strain, angle, speed, activity, lobes, petalFolds: [...petalFolds], foldWeights};
    }
  };
}

export const AI_REST_PATH = ribbonPath();

const TAU = Math.PI * 2;
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const number = value => value.toFixed(4);

function contour(sample) {
  const count = 96, step = TAU / count, epsilon = .0001;
  const point = angle => {
    const value = sample(angle), before = sample(angle - epsilon), after = sample(angle + epsilon);
    return {...value, dx:(after.x - before.x) / (2 * epsilon), dy:(after.y - before.y) / (2 * epsilon)};
  };
  let previous = point(0), d = `M${number(previous.x)} ${number(previous.y)}`, front = '', open = false;
  const points = [previous];
  for (let index = 1; index <= count; index++) {
    const next = point(index * step);
    const segment = 'C' + [
      previous.x + previous.dx * step / 3, previous.y + previous.dy * step / 3,
      next.x - next.dx * step / 3, next.y - next.dy * step / 3, next.x, next.y
    ].map(number).join(' ');
    d += segment;
    if ((previous.z + next.z) / 2 > .3) {
      if (!open) front += `M${number(previous.x)} ${number(previous.y)}`;
      front += segment; open = true;
    } else open = false;
    previous = next; points.push(next);
  }
  return {d:d + 'Z',front,points};
}

function infinityContour(state = {activity:0}) {
  // Complete the handoff so active geometry matches the living ribbon exactly.
  const progress = clamp(state.activity / .98,0,1);
  const mix = progress * progress * (3 - 2 * progress);
  return contour(a => {
    const x = 12 + 8.2 * Math.sin(a), y = 12 + 4.1 * Math.sin(2 * a);
    if (mix === 0) return {x,y,z:0};
    const point = liquidPoint(a,state);
    if (mix === 1) return {x:point.horizontal,y:point.vertical,z:0};
    return {x:x + (point.horizontal - x) * mix,y:y + (point.vertical - y) * mix,z:0};
  });
}

const infinityRest = infinityContour();
export const HYBRID_REST_PATH = infinityRest.d;
export const HYBRID_REST_POINTS = infinityRest.points;

export function createHybridMotion() {
  let motion = createMotion(), travel = 0, speed = 0, thought = 0;
  return {
    step(seconds, phase, reduced = false) {
      const dt = clamp(seconds,0,.05);
      if (reduced) {
        motion = createMotion(); travel = speed = thought = 0;
      }
      const state = motion.step(dt,phase,reduced), {activity,angle} = state;
      if (!reduced) {
        speed += ((phase === 'answering' ? 24 : 18) - speed) * -Math.expm1(-dt / .5);
        const target = phase === 'working' ? 1 : 0;
        thought += (target - thought) * -Math.expm1(-dt / .35);
        if (Math.abs(target - thought) < .001) thought = target;
        travel = (travel + dt * speed * activity) % 100;
      }
      if (activity === 0) {
        thought = 0;
        return {d:HYBRID_REST_PATH,front:'',points:[],activity:0,angle:0,trace:0,traceLength:100,trackOpacity:1,traceOpacity:0};
      }
      return {...infinityContour(state),activity,angle,trace:-travel,
        traceLength:100 - 45 * thought,trackOpacity:.06 + .94 * (1 - thought),traceOpacity:thought};
    }
  };
}
