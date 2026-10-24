import { expect, test } from '@playwright/test';
import { api, createUser, signedInContext, unique } from './helpers';

test.describe('Layout, icons and search', () => {
  test('computer layout: sidebar with labels on the left, feed in the middle, suggestions on the right', async ({ browser }) => {
    const u = await createUser('ly');
    await createUser('ly2', 'Someone To Follow');
    const { page, ctx } = await signedInContext(browser, u); // 1100 px wide: sidebar and right rail
    const nav = page.getByRole('navigation', { name: 'Main' });
    const sidebar = await page.locator('.topbar').boundingBox();
    expect(sidebar.x).toBe(0);
    expect(sidebar.height).toBeGreaterThan(700); // a tall column, not a top strip
    for (const label of ['Home', 'Search', 'Create', 'Reels', 'Activity', 'Messages', 'Profile', 'Settings']) {
      await expect(nav.getByText(label, { exact: true })).toBeVisible(); // labels are visible, not just icons
    }
    const rail = page.getByRole('complementary', { name: 'Suggestions' });
    await expect(rail.getByRole('heading', { name: 'People to follow' })).toBeVisible();
    const feedBox = await page.locator('.home-feed').boundingBox();
    const railBox = await rail.boundingBox();
    expect(railBox.x).toBeGreaterThan(feedBox.x + feedBox.width - 1); // right of the feed
    await ctx.close();
  });

  test('tablet and phone: no side rail, suggestions sit inside the feed as a strip', async ({ browser }) => {
    const u = await createUser('lt');
    await createUser('lt2');
    const ctx = await browser.newContext({ viewport: { width: 700, height: 900 } });
    const page = await ctx.newPage();
    await page.goto('/signin');
    await page.getByLabel('Username, email or phone').fill(u.username);
    await page.getByLabel('Password', { exact: true }).fill(u.password);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.locator('.mainnav')).toBeVisible();
    await expect(page.getByRole('complementary', { name: 'Suggestions' })).toHaveCount(0);
    await expect(page.locator('.home-feed .suggest.strip')).toBeVisible();
    await ctx.close();
  });

  test('the Share icon and the Messages icon are different pictures', async ({ browser }) => {
    const u = await createUser('ic');
    await api('POST', '/posts', u.token, { caption: 'icon check' });
    const { page, ctx } = await signedInContext(browser, u);
    const messages = await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Messages' }).locator('svg').first().innerHTML();
    const share = await page.locator('.post').first().getByRole('button', { name: 'Share', exact: true }).locator('svg').innerHTML();
    const comment = await page.locator('.post').first().getByRole('button', { name: 'Comments' }).locator('svg').innerHTML();
    expect(messages).not.toBe(share);
    expect(messages).not.toBe(comment);
    expect(share).not.toBe(comment);
    await ctx.close();
  });

  test('search: trending hashtags as chips, then people and hashtag cards as you type', async ({ browser }) => {
    const author = await createUser('sa', 'Searchable Sam');
    const tag = unique('trend');
    await api('POST', '/posts', author.token, { caption: `So good #${tag}` });
    const viewer = await createUser('sv');
    const { page, ctx } = await signedInContext(browser, viewer);
    await page.goto('/search');
    await expect(page.getByRole('heading', { name: 'Search', exact: true })).toBeVisible();
    // Trending shows the most used hashtags of the last 30 days (top 10), so check the chips themselves, not one particular tag.
    const chips = page.getByLabel('Trending hashtags').getByRole('link');
    await expect(chips.first()).toBeVisible();
    await page.getByLabel('Search people').fill(author.username);
    await expect(page.getByRole('heading', { name: 'People' })).toBeVisible();
    await expect(page.locator('.person-card').filter({ hasText: author.username })).toBeVisible();
    await page.getByLabel('Search people').fill(tag.slice(0, 6));
    await expect(page.getByLabel('Hashtags').getByText(`#${tag}`)).toBeVisible();
    await page.getByRole('button', { name: 'Clear search' }).click();
    await expect(page.getByLabel('Search people')).toHaveValue('');
    await expect(chips.first()).toBeVisible();
    const name = (await chips.first().innerText()).replace('#', '');
    await chips.first().click();
    await expect(page).toHaveURL(new RegExp(`/tag/${name}`));
    await expect(page.getByRole('heading', { name: `#${name}` })).toBeVisible();
    await ctx.close();
  });
});
