import React from 'react';
import { FormDropdown } from './FormDropdown';
import { Toggle } from './Toggle';
import { BuildingInfo } from '../../types/order';
import { AdminOptionType } from '../../types/admin';

interface BuildingSectionProps {
  building: BuildingInfo;
  onChange: (field: keyof BuildingInfo, value: string | boolean) => void;
  adminOptions: Record<AdminOptionType, string[]>;
  optionsLoading?: boolean;
}

export function BuildingSection({
  building,
  onChange,
  adminOptions,
  optionsLoading,
}: BuildingSectionProps) {
  const handleDropdownChange = (name: string, value: string) => {
    onChange(name as keyof BuildingInfo, value);
  };

  const handleToggleChange = (name: string, value: boolean) => {
    onChange(name as keyof BuildingInfo, value);
  };

  return (
    <div style={styles.section}>
      <h3 style={styles.sectionTitle}>Building Project</h3>
      <div style={styles.grid}>
        <FormDropdown
          label="Manufacturer"
          name="manufacturer"
          value={building.manufacturer}
          onChange={handleDropdownChange}
          options={adminOptions.manufacturers || []}
          loading={optionsLoading}
          required
        />
        <FormDropdown
          label="Building Type"
          name="buildingType"
          value={building.buildingType}
          onChange={handleDropdownChange}
          options={adminOptions.building_types || []}
          loading={optionsLoading}
          required
        />
        <FormDropdown
          label="Overall Width"
          name="overallWidth"
          value={building.overallWidth}
          onChange={handleDropdownChange}
          options={adminOptions.overall_widths || []}
          loading={optionsLoading}
          required
        />
        <FormDropdown
          label="Building Length"
          name="buildingLength"
          value={building.buildingLength}
          onChange={handleDropdownChange}
          options={adminOptions.building_lengths || []}
          loading={optionsLoading}
          required
        />
        <FormDropdown
          label="Base Rail Length"
          name="baseRailLength"
          value={building.baseRailLength}
          onChange={handleDropdownChange}
          options={adminOptions.base_rail_lengths || []}
          loading={optionsLoading}
          required
        />
        <FormDropdown
          label="Building Height"
          name="buildingHeight"
          value={building.buildingHeight}
          onChange={handleDropdownChange}
          options={adminOptions.building_heights || []}
          loading={optionsLoading}
          required
        />
        <FormDropdown
          label="Foundation Type"
          name="foundationType"
          value={building.foundationType}
          onChange={handleDropdownChange}
          options={adminOptions.foundation_types || []}
          loading={optionsLoading}
          required
        />
        <FormDropdown
          label="Permitting Structure"
          name="permittingStructure"
          value={building.permittingStructure}
          onChange={handleDropdownChange}
          options={adminOptions.permitting_structures || []}
          loading={optionsLoading}
          required
        />
        <FormDropdown
          label="Drawing Type"
          name="drawingType"
          value={building.drawingType}
          onChange={handleDropdownChange}
          options={adminOptions.drawing_types || []}
          loading={optionsLoading}
        />
        <div /> {/* Spacer for grid alignment */}
        <div style={styles.toggleRow}>
          <Toggle
            label="Lull Lift Required"
            name="lullLiftRequired"
            value={building.lullLiftRequired}
            onChange={handleToggleChange}
          />
        </div>
        <div style={styles.toggleRow}>
          <Toggle
            label="Customer Land Is Ready"
            name="customerLandIsReady"
            value={building.customerLandIsReady}
            onChange={handleToggleChange}
          />
        </div>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  section: {
    backgroundColor: 'white',
    borderRadius: '8px',
    padding: '24px',
    boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
  },
  sectionTitle: {
    margin: '0 0 20px 0',
    fontSize: '18px',
    fontWeight: 600,
    color: '#333',
    paddingBottom: '12px',
    borderBottom: '2px solid #2196F3',
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: '16px',
  },
  toggleRow: {
    display: 'flex',
    alignItems: 'center',
    padding: '8px 0',
  },
};
