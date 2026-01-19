// Text anchor configuration for Eagle Carports Order Forms
// SignNow searches for these text patterns and places fields relative to them

export interface AnchorConfig {
  searchTexts: string[];
  offsetX: number;
  offsetY: number;
  width: number;
  height: number;
}

export const anchorConfig = {
  // Signature fields - matches patterns in Eagle Carports forms:
  // Page 1: "Customer Signature ___" (appears twice)
  // Page 2: "CUSTOMER SIGNATURE:___"
  // Page 3: "Customer Signature___"
  signature: {
    searchTexts: [
      'Customer Signature',
      'CUSTOMER SIGNATURE:',
      'Customer Signature_',
    ],
    offsetX: 160,    // Position after "Customer Signature" text
    offsetY: -5,
    width: 250,
    height: 40,
  } as AnchorConfig,

  // Date fields - follows signature on same line
  // Page 1: "Date ______" (appears twice after signatures)
  // Page 2: "DATE:_____"
  // Page 3: "Date ___"
  date: {
    searchTexts: [
      'Date _',
      'DATE:_',
      'Date_',
    ],
    offsetX: 50,
    offsetY: -5,
    width: 120,
    height: 25,
  } as AnchorConfig,

  // Installer signature (internal use)
  installerSignature: {
    searchTexts: [
      'Installer Signature:',
    ],
    offsetX: 20,
    offsetY: 15,
    width: 200,
    height: 35,
  } as AnchorConfig,
};
