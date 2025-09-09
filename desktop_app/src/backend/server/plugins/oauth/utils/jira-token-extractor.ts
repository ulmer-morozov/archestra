import { urlMatchesPage } from './browser-auth-utils';

/**
 * Utilities for extracting Jira authentication tokens from the browser
 */

/**
 * Check if URL is Atlassian login page
 */
export function isAtlassianInLoginPage(url: string): boolean {
  return urlMatchesPage(url, 'id.atlassian.com', '/login', '/signin');
}

/**
 * Validate if page is on authenticated page of Atlassian website
 */
export function isAtlassianAuthenticatedPage(url: string): boolean {
  return urlMatchesPage(url, 'id.atlassian.com', '/manage-profile') || urlMatchesPage(url, 'home.atlassian.com');
}
