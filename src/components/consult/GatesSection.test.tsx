import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ConsultFormData } from './consultTypes';
import { GatesSection } from './GatesSection';

function gateData(qty = 0): ConsultFormData {
  return {
    gates: { walk: { qty, price: 425 }, double: { qty: 0, price: 850 } },
    gateInstances: [],
  } as unknown as ConsultFormData;
}

describe('GatesSection quantity boundary', () => {
  it.each([
    ['negative', '-2', 0],
    ['fractional', '1.9', 1],
    ['non-finite', 'Infinity', 0],
    ['valid integer', '2', 2],
  ])('normalizes %s user input before updating form state', (_label, input, expected) => {
    const onChange = vi.fn();
    render(<GatesSection data={gateData()} onChange={onChange} />);

    fireEvent.change(screen.getAllByRole('spinbutton')[0], { target: { value: input } });

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0].gates.walk.qty).toBe(expected);
    expect(onChange.mock.calls[0][0].gateInstances).toHaveLength(expected);
  });
});
