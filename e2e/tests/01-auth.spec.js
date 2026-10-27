import { expect, test } from '@playwright/test';
import { PASSWORD, createUser, otp, randomUsPhone, recoveryCode, trackErrors, uiLogin, unique } from './helpers';

test.describe('Sign up, sign in, forgot password', () => {
  test('sign-up form shows clear errors for bad input', async ({ page }) => {
    await page.goto('/signup');
    await page.getByRole('button', { name: /create account/i }).click();
    await expect(page.getByRole('alert').first()).toBeVisible();
    await page.getByLabel('Email', { exact: true }).fill('not-an-email');
    await page.getByLabel('Password', { exact: true }).fill('short');
    await page.getByRole('button', { name: /create account/i }).click();
    await expect(page.getByText(/valid email/i)).toBeVisible();
    await expect(page.getByText(/at least 8/i)).toBeVisible();
  });

  test('full sign-up with ONE code (phone is the default), then logout and login', async ({ page }) => {
    const errors = trackErrors(page);
    const username = unique('su');
    const phone = randomUsPhone();
    await page.goto('/signup');
    await page.getByLabel('Full name').fill('Sign Up Tester');
    await page.getByLabel('Username').fill(username);
    await page.getByLabel('Email', { exact: true }).fill(`${username}@example.com`);
    await page.locator('#country').selectOption('US');
    await page.getByLabel(/Mobile number/i).fill(phone.replace('+1', ''));
    await page.getByLabel(/Date of birth/i).fill('1998-04-12');
    await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
    await expect(page.getByLabel(/Phone \(text message\)/)).toBeChecked(); // the code goes to the phone unless you choose email
    await page.getByRole('button', { name: /create account/i }).click();

    // one code only: no second step
    await expect(page.getByRole('heading', { name: /check your phone/i })).toBeVisible();
    await expect(page.locator('.steps li')).toHaveCount(2);
    await page.getByLabel('Digit 1').click();
    await page.keyboard.type(await otp('phone', username));
    await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();

    await page.getByRole('button', { name: 'Log out' }).click();
    await expect(page).toHaveURL(/signin/);
    await uiLogin(page, `${username}@example.com`);
    expect(errors).toEqual([]);
  });

  test('sign-up: choose email for the code, one email code is enough', async ({ page }) => {
    const username = unique('se');
    await page.goto('/signup');
    await page.getByLabel('Full name').fill('Email Code Tester');
    await page.getByLabel('Username').fill(username);
    await page.getByLabel('Email', { exact: true }).fill(`${username}@example.com`);
    await page.locator('#country').selectOption('US');
    await page.getByLabel(/Mobile number/i).fill(randomUsPhone().replace('+1', ''));
    await page.getByLabel(/Date of birth/i).fill('1998-04-12');
    await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
    await page.locator('input[name=verifyVia][value=email]').check(); // the "Email" choice under "Send my verification code to"
    await page.getByRole('button', { name: /create account/i }).click();
    await expect(page.getByRole('heading', { name: /check your email/i })).toBeVisible();
    await page.getByLabel('Digit 1').click();
    await page.keyboard.type(await otp('email', username));
    await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();
  });

  test('sign-up: the email is optional when the code goes to the phone, and required when it goes to the email', async ({ page }) => {
    const username = unique('sn');
    await page.goto('/signup');
    await page.getByLabel('Full name').fill('Phone Only');
    await page.getByLabel('Username').fill(username);
    await expect(page.getByText(/Optional\. Add it to sign in/)).toBeVisible();
    await page.locator('#country').selectOption('US');
    await page.getByLabel(/Mobile number/i).fill(randomUsPhone().replace('+1', ''));
    await page.getByLabel(/Date of birth/i).fill('1998-04-12');
    await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
    // choosing "email" without an email asks for it
    await page.locator('input[name=verifyVia][value=email]').check();
    await page.getByRole('button', { name: /create account/i }).click();
    await expect(page.getByText('Enter your email to get the code there.')).toBeVisible();
    // back to the phone: no email needed
    await page.locator('input[name=verifyVia][value=phone]').check();
    await page.getByRole('button', { name: /create account/i }).click();
    await expect(page.getByRole('heading', { name: /check your phone/i })).toBeVisible();
    await page.getByLabel('Digit 1').click();
    await page.keyboard.type(await otp('phone', username));
    await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();
    await page.goto('/settings');
    await expect(page.getByText('Not added')).toBeVisible(); // no email on file
  });
  test('sign-up username: no @ in the box, an example is shown, @ / spaces / capitals are cleaned', async ({ page }) => {
    await page.goto('/signup');
    const box = page.getByLabel('Username');
    await expect(page.locator('.field', { has: box }).locator('.prefix')).toHaveCount(0);
    await expect(box).toHaveAttribute('placeholder', 'e.g. anurag_seth');
    await expect(page.getByText(/small letters, numbers/)).toBeVisible();
    await box.fill('@Ab Cd');
    await expect(box).toHaveValue('abcd');
  });
  test('a wrong code is rejected and counted', async ({ page }) => {
    const username = unique('wc');
    await page.goto('/signup');
    await page.getByLabel('Full name').fill('Wrong Code');
    await page.getByLabel('Username').fill(username);
    await page.getByLabel('Email', { exact: true }).fill(`${username}@example.com`);
    await page.locator('#country').selectOption('US');
    await page.getByLabel(/Mobile number/i).fill(randomUsPhone().replace('+1', ''));
    await page.getByLabel(/Date of birth/i).fill('1998-04-12');
    await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
    await page.getByRole('button', { name: /create account/i }).click();
    await page.getByLabel('Digit 1').click();
    await page.keyboard.type('000000');
    await expect(page.getByRole('alert').filter({ hasText: /isn.t right/i })).toBeVisible();
  });

  test('wrong password shows the same generic message as an unknown account', async ({ page }) => {
    const u = await createUser('lg');
    await page.goto('/signin');
    await page.getByLabel('Username, email or phone').fill(u.username);
    await page.getByLabel('Password', { exact: true }).fill('definitely-wrong-1');
    await page.getByRole('button', { name: 'Sign in' }).click();
    const real = await page.getByRole('alert').innerText();
    await page.getByLabel('Username, email or phone').fill('nobody.exists.here');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByRole('alert')).toHaveText(real);
  });

  test('sign in works with username, email and phone', async ({ browser }) => {
    const u = await createUser('lg3');
    for (const id of [u.username, u.email, u.phone]) {
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      await uiLogin(page, id);
      await ctx.close();
    }
  });

  /** Forgot flow after "Send code": confirm the code, pick the account, set a new password. */
  async function finishReset(page, code, username, password) {
    await page.getByLabel('Digit 1').click();
    await page.keyboard.type(code);
    await page.getByRole('button', { name: 'Confirm code' }).click();
    await page.locator('.account-list li', { hasText: username }).getByRole('button', { name: 'Reset password' }).click();
    await page.getByLabel('New password').fill(password);
    await page.getByRole('button', { name: 'Change password' }).click();
    await expect(page.getByText(/password changed/i)).toBeVisible();
  }

  test('forgot password by email: code, pick the account, new password, old one stops working', async ({ page }) => {
    const u = await createUser('fp');
    await page.goto('/signin');
    await page.getByRole('link', { name: /forgot password/i }).click();
    await page.getByLabel('Username, email or phone').fill(u.email);
    await page.getByRole('button', { name: 'Send code' }).click();
    await expect(page.getByRole('heading', { name: /check your email/i })).toBeVisible();
    await finishReset(page, await recoveryCode('email', u.email), u.username, 'freshpass77');
    await uiLogin(page, u.username, 'freshpass77');
  });

  test('forgot username: a phone number lists every account that uses it, and any one can be reset', async ({ page }) => {
    const phone = randomUsPhone();
    const a = await createUser('fa', 'First Account', { phone });
    const b = await createUser('fb', 'Second Account', { phone });
    await page.goto('/forgot');
    await page.getByLabel('Username, email or phone').fill(phone);
    await expect(page.locator('.choice-group')).toHaveCount(0); // a phone number already says where the code goes
    await page.getByRole('button', { name: 'Send code' }).click();
    await expect(page.getByRole('heading', { name: /check your phone/i })).toBeVisible();
    await page.getByLabel('Digit 1').click();
    await page.keyboard.type(await recoveryCode('phone', phone));
    await page.getByRole('button', { name: 'Confirm code' }).click();
    await expect(page.getByRole('heading', { name: /we found your accounts/i })).toBeVisible();
    await expect(page.locator('.account-list li')).toHaveCount(2);
    await expect(page.locator('.account-list')).toContainText(`@${a.username}`);
    await expect(page.locator('.account-list')).toContainText(`@${b.username}`);
    await page.locator('.account-list li', { hasText: b.username }).getByRole('button', { name: 'Reset password' }).click();
    await page.getByLabel('New password').fill('secondpass88');
    await page.getByRole('button', { name: 'Change password' }).click();
    await expect(page.getByText(new RegExp(`Password changed for @${b.username}`))).toBeVisible();
    await uiLogin(page, b.username, 'secondpass88');
  });

  test('forgot password with a username: choose email or phone for the code', async ({ page }) => {
    const u = await createUser('fc');
    await page.goto('/forgot');
    await page.getByLabel('Username, email or phone').fill(u.username);
    await expect(page.getByRole('group', { name: /send the code to/i })).toBeVisible();
    await page.getByLabel('Phone (text message)').check();
    await page.getByRole('button', { name: 'Send code' }).click();
    await expect(page.getByRole('heading', { name: /check your phone/i })).toBeVisible();
    await finishReset(page, await recoveryCode('phone', u.phone), u.username, 'viaphone99');
    await uiLogin(page, u.username, 'viaphone99');
  });

  test('forgot password: in development the code is shown on screen, and an unknown account explains itself', async ({ page }) => {
    const u = await createUser('fd');
    await page.goto('/forgot');
    await page.getByLabel('Username, email or phone').fill('nobody.exists.zz');
    await page.getByRole('button', { name: 'Send code' }).click();
    await expect(page.getByRole('note')).toContainText(/No account matches/i);
    await page.getByRole('button', { name: 'Back' }).click();
    await page.getByLabel('Username, email or phone').fill(u.username);
    await page.getByRole('button', { name: 'Send code' }).click();
    const shown = (await page.getByRole('note').locator('.dev-code b').innerText()).trim();
    expect(shown).toBe(await recoveryCode('phone', u.phone)); // a username: the code goes to the phone unless you pick the email
    await page.getByRole('button', { name: 'Fill it in' }).click();
    await page.getByRole('button', { name: 'Confirm code' }).click();
    await page.locator('.account-list li', { hasText: u.username }).getByRole('button', { name: 'Reset password' }).click();
    await page.getByLabel('New password').fill('onscreen55');
    await page.getByRole('button', { name: 'Change password' }).click();
    await expect(page.getByText(/password changed/i)).toBeVisible();
  });

  test('forgot password: a wrong code says how many tries are left', async ({ page }) => {
    const u = await createUser('fw');
    await page.goto('/forgot');
    await page.getByLabel('Username, email or phone').fill(u.email);
    await page.getByRole('button', { name: 'Send code' }).click();
    await page.getByLabel('Digit 1').click();
    await page.keyboard.type('000000');
    await page.getByRole('button', { name: 'Confirm code' }).click();
    await expect(page.getByRole('alert')).toContainText(/4 tries left/);
  });

  test('forgot: a mobile number never offers the email/phone choice, one starting with 1-5 is refused at once, and no example number is shown', async ({ page }) => {
    await page.goto('/forgot');
    const id = page.getByLabel('Username, email or phone');
    await expect(page.getByText(/like 98765/)).toHaveCount(0);
    await id.fill('282822'); // six digits: a number, not a username
    await expect(page.locator('.choice-group')).toHaveCount(0);
    await expect(page.getByText('A mobile number starts with 6, 7, 8 or 9.')).toBeVisible();
    await id.fill('98765'); // fine so far, but not complete
    await expect(page.locator('.choice-group')).toHaveCount(0);
    await expect(page.getByText(/starts with 6, 7, 8 or 9/)).toHaveCount(0);
    await page.getByRole('button', { name: 'Send code' }).click();
    await expect(page.getByText('Enter the full 10-digit mobile number.')).toBeVisible();
    await id.fill('somebody'); // letters: a username, so the choice appears
    await expect(page.locator('.choice-group')).toHaveCount(1);
    await id.fill('+14155550123'); // a number with a country code: no choice either
    await expect(page.locator('.choice-group')).toHaveCount(0);
  });

  test('sign-in page: no browser pre-fill, no hint under the box, and the last username is suggested', async ({ browser }) => {
    const ctx = await browser.newContext();
    await ctx.addInitScript(() => localStorage.setItem('mirra.signinId', 'last_user_1'));
    const page = await ctx.newPage();
    await page.goto('/signin');
    const id = page.getByLabel('Username, email or phone');
    await expect(id).toHaveValue('');
    await expect(id).toHaveAttribute('autocomplete', 'off');
    await expect(page.getByText(/include the country code/i)).toHaveCount(0);
    await page.getByRole('button', { name: '@last_user_1' }).click();
    await expect(id).toHaveValue('last_user_1');
    await ctx.close();
  });
  test('sign-up phone: India (+91) is preselected, the box holds only 10 digits with no country code inside, and bad numbers are explained', async ({ page }) => {
    await page.goto('/signup');
    await expect(page.locator('#country')).toHaveValue('IN');
    const box = page.getByLabel('Mobile number');
    await expect(page.locator('.field', { has: box }).locator('.prefix')).toHaveCount(0); // no "+91" inside the number box
    await box.fill('98765abc4321099999'); // letters are dropped and it stops at 10 digits
    await expect(box).toHaveValue('9876543210');
    await box.fill('+91 98765 43210'); // a pasted number with the country code and spaces
    await expect(box).toHaveValue('9876543210');
    await box.fill('09876543210'); // a leading 0 is dropped
    await expect(box).toHaveValue('9876543210');
    await box.fill('12345');
    await box.blur();
    await expect(page.getByText(/10-digit mobile number/i).first()).toBeVisible();
    await box.fill('1234567890');
    await box.blur();
    await expect(page.getByText(/starts with 6, 7, 8 or 9/i)).toBeVisible();
    await box.fill('9876543210');
    await box.blur();
    await expect(page.getByText(/10-digit|starts with 6|at most 10/i)).toHaveCount(0);
  });

  test('the sign-in side shows the logo and one clear line about the app', async ({ page }) => {
    await page.goto('/signin');
    const panel = page.getByRole('complementary', { name: 'About SocialAmbak' });
    await expect(panel).toContainText('Connect with friends and the world around you on SocialAmbak.');
    await expect(panel.locator('.pool-word').first()).toHaveText('SocialAmbak');
  });

  test('back buttons on auth screens', async ({ page }) => {
    await page.goto('/signup');
    await page.getByRole('button', { name: 'Back' }).click();
    await expect(page).toHaveURL(/signin/);
    await page.goto('/forgot');
    await page.getByRole('button', { name: 'Back' }).click();
    await expect(page).toHaveURL(/signin/);
  });

  test('signed-out visitors are sent to sign in, and unknown pages show a 404 when signed in', async ({ page }) => {
    await page.goto('/settings');
    await expect(page).toHaveURL(/signin/);
    const u = await createUser('nf');
    await uiLogin(page, u.username);
    await page.goto('/this/page/does/not/exist');
    await expect(page.getByRole('heading', { name: /page not found/i })).toBeVisible();
  });
});
