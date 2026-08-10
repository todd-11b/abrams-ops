import { render, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ConsultFormData } from './consultTypes';
import { VisualLayoutSection } from './VisualLayoutSection';

function layoutData(overrides: Partial<ConsultFormData> = {}): ConsultFormData {
  return {
    fenceLines: [],
    gates: { walk: { qty: 0, price: 425 }, double: { qty: 0, price: 850 } },
    gateInstances: [],
    obstructions: [],
    ...overrides,
  } as unknown as ConsultFormData;
}

describe('VisualLayoutSection synchronization', () => {
  it('initializes a missing fence position once without overwriting the updated line', async () => {
    const firstChange = vi.fn();
    const line = { id: 'line-1', label: 'Main Run', style: 'wood_pine_6', linearFeet: 10, pricePerSection: 120 };
    const { rerender } = render(
      <VisualLayoutSection data={layoutData({ fenceLines: [line] })} onChange={firstChange} />,
    );

    await waitFor(() => expect(firstChange).toHaveBeenCalledTimes(1));
    const positioned = firstChange.mock.calls[0][0].fenceLines;
    const laterChange = vi.fn();
    rerender(
      <VisualLayoutSection data={layoutData({ fenceLines: positioned })} onChange={laterChange} />,
    );

    expect(laterChange).not.toHaveBeenCalled();
  });

  it('uses the current callback when gate quantity changes', async () => {
    const firstChange = vi.fn();
    const { rerender } = render(
      <VisualLayoutSection data={layoutData()} onChange={firstChange} />,
    );
    expect(firstChange).not.toHaveBeenCalled();

    const laterChange = vi.fn();
    rerender(
      <VisualLayoutSection
        data={layoutData({ gates: { walk: { qty: 1, price: 425 }, double: { qty: 0, price: 850 } } })}
        onChange={laterChange}
      />,
    );

    await waitFor(() => expect(laterChange).toHaveBeenCalledTimes(1));
    expect(laterChange.mock.calls[0][0].gateInstances).toHaveLength(1);
  });

  it.each([
    ['negative', -1, 0],
    ['fractional', 1.9, 1],
    ['NaN', Number.NaN, 0],
    ['infinite', Number.POSITIVE_INFINITY, 0],
  ])('normalizes %s gate quantities to a convergent target', async (_label, qty, expected) => {
    const onChange = vi.fn();
    const { rerender } = render(
      <VisualLayoutSection
        data={layoutData({ gates: { walk: { qty, price: 425 }, double: { qty: 0, price: 850 } } })}
        onChange={onChange}
      />,
    );

    if (expected === 0) {
      expect(onChange).not.toHaveBeenCalled();
      return;
    }

    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
    const gateInstances = onChange.mock.calls[0][0].gateInstances;
    expect(gateInstances).toHaveLength(expected);
    rerender(
      <VisualLayoutSection
        data={layoutData({
          gates: { walk: { qty, price: 425 }, double: { qty: 0, price: 850 } },
          gateInstances,
        })}
        onChange={onChange}
      />,
    );
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('removes restored gate instances when their quantity normalizes to zero', async () => {
    const onChange = vi.fn();
    render(
      <VisualLayoutSection
        data={layoutData({
          gates: { walk: { qty: Number.NaN, price: 425 }, double: { qty: 0, price: 850 } },
          gateInstances: [{ id: 'gate-1', type: 'walk' }],
        })}
        onChange={onChange}
      />,
    );

    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
    expect(onChange.mock.calls[0][0].gateInstances).toEqual([]);
  });
});
