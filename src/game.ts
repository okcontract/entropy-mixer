export const TARGET_COUNT = 16;

export type TargetPosition = Readonly<{ x: number; y: number }>;
export type PointerActivation = Readonly<{
  button: number;
  isPrimary: boolean;
  pointerType: string;
}>;

export const TARGET_POSITIONS: readonly TargetPosition[] = [
  { x: 0.16, y: 0.2 },
  { x: 0.78, y: 0.72 },
  { x: 0.55, y: 0.35 },
  { x: 0.23, y: 0.82 },
  { x: 0.86, y: 0.18 },
  { x: 0.41, y: 0.66 },
  { x: 0.68, y: 0.88 },
  { x: 0.12, y: 0.5 },
  { x: 0.72, y: 0.42 },
  { x: 0.35, y: 0.14 },
  { x: 0.88, y: 0.61 },
  { x: 0.48, y: 0.88 },
  { x: 0.28, y: 0.43 },
  { x: 0.63, y: 0.19 },
  { x: 0.84, y: 0.86 },
  { x: 0.18, y: 0.69 },
];

export const targetPosition = (index: number): TargetPosition => {
  const position = TARGET_POSITIONS[index];
  if (!position) throw new RangeError(`No target position at index ${index}`);
  return position;
};

export const isPrimaryPointerActivation = (event: PointerActivation): boolean =>
  event.isPrimary && event.button === 0;
