/** The kinds of trains; their look lives in scene/train.ts. */
export type TrainType = "steam" | "diesel" | "electric" | "express";

export interface TrainTypeInfo {
  id: TrainType;
  name: string;
  maxKmh: number;
  /** km/h per second. */
  accel: number;
  /** Wagons (for the high-speed train: middle cars) a new train gets, and the most it can take. */
  wagons: number;
  maxWagons: number;
}

export const TRAIN_TYPES: TrainTypeInfo[] = [
  { id: "steam", name: "Steam train", maxKmh: 80, accel: 12, wagons: 4, maxWagons: 8 },
  { id: "diesel", name: "Diesel freight", maxKmh: 100, accel: 8, wagons: 6, maxWagons: 10 },
  { id: "electric", name: "Electric passenger", maxKmh: 140, accel: 16, wagons: 4, maxWagons: 8 },
  { id: "express", name: "High-speed train", maxKmh: 200, accel: 20, wagons: 3, maxWagons: 6 },
];

export const trainType = (id: string): TrainTypeInfo => TRAIN_TYPES.find((t) => t.id === id) ?? TRAIN_TYPES[0];
export const isTrainType = (v: unknown): v is TrainType => TRAIN_TYPES.some((t) => t.id === v);
