import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/svelte';

describe('MemoFlow shell', () => {
  it('renders the MemoFlow title', async () => {
    const { default: App } = await import('../../src/routes/+page.svelte');
    render(App);
    expect(screen.getByRole('heading', { name: 'MemoFlow' })).toBeInTheDocument();
  });
});
