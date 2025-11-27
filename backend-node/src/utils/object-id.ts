import { Types } from 'mongoose';

export const toObjectIdString = (value: unknown): string => {
  if (!value) {
    return '';
  }

  if (value instanceof Types.ObjectId) {
    return value.toString();
  }

  if (typeof value === 'string') {
    return value;
  }

  if (
    typeof value === 'object' &&
    value !== null &&
    '_id' in value &&
    value._id
  ) {
    return toObjectIdString((value as { _id: unknown })._id);
  }

  return String(value);
};

