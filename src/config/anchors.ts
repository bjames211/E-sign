// Text anchor configuration for finding signature/date fields in PDFs
// The system searches for these text patterns and places fields relative to them

export interface AnchorConfig {
  searchTexts: string[];  // Text patterns to search for
  offsetX: number;        // Horizontal offset from anchor (pixels)
  offsetY: number;        // Vertical offset from anchor (pixels)
  width: number;          // Field width
  height: number;         // Field height
}

export const anchorConfig = {
  signature: {
    searchTexts: [
      'Signature:',
      'Sign here:',
      'Authorized Signature:',
      'Client Signature:',
      'Signed:',
      'X__________',
      'Sign Here',
    ],
    offsetX: 100,
    offsetY: -5,
    width: 200,
    height: 40,
  } as AnchorConfig,

  date: {
    searchTexts: [
      'Date:',
      'Dated:',
      'Signed Date:',
      'Date Signed:',
    ],
    offsetX: 60,
    offsetY: -5,
    width: 100,
    height: 20,
  } as AnchorConfig,

  initials: {
    searchTexts: [
      'Initials:',
      'Initial:',
      'Initial Here:',
    ],
    offsetX: 80,
    offsetY: -5,
    width: 60,
    height: 30,
  } as AnchorConfig,
};

export type AnchorType = keyof typeof anchorConfig;
