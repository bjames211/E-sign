export type AdminOptionType =
  | 'manufacturers'
  | 'building_types'
  | 'overall_widths'
  | 'building_lengths'
  | 'base_rail_lengths'
  | 'building_heights'
  | 'foundation_types'
  | 'permitting_structures'
  | 'drawing_types'
  | 'sales_persons'
  | 'states';

export interface AdminOption {
  id?: string;
  type: AdminOptionType;
  values: string[];
}

export const ADMIN_OPTION_LABELS: Record<AdminOptionType, string> = {
  manufacturers: 'Manufacturers',
  building_types: 'Building Types',
  overall_widths: 'Overall Widths',
  building_lengths: 'Building Lengths',
  base_rail_lengths: 'Base Rail Lengths',
  building_heights: 'Building Heights',
  foundation_types: 'Foundation Types',
  permitting_structures: 'Permitting Structures',
  drawing_types: 'Drawing Types',
  sales_persons: 'Sales Persons',
  states: 'States',
};

export const ALL_ADMIN_OPTION_TYPES: AdminOptionType[] = [
  'manufacturers',
  'building_types',
  'overall_widths',
  'building_lengths',
  'base_rail_lengths',
  'building_heights',
  'foundation_types',
  'permitting_structures',
  'drawing_types',
  'sales_persons',
  'states',
];
