// """API client for making authenticated requests to backend.

// [Task]: T064, T077, T078
// [From]: specs/001-user-auth/tasks.md (User Story 3)

// This client provides a wrapper around fetch that automatically:
// - Sends httpOnly cookies with JWT tokens
// - Handles authentication errors
// - Provides typed response handling
// - Retry logic with exponential backoff (max 3 retries)
// - Request timeout (10 seconds)

// Usage:
// ```typescript
// import { apiClient } from '@/lib/api/client';

// // Get tasks for authenticated user
// const tasks = await apiClient({ url: '/api/tasks' });

// // Create a new task
// const newTask = await apiClient({
//   url: '/api/tasks',
//   method: 'POST',
//   data: { title: 'My Task', description: 'Task description' }
// });
// ```
// */

const MAX_RETRIES = 3;
const TIMEOUT_MS = 10000; // 10 seconds
const BASE_DELAY_MS = 1000; // 1 second

// Helper function for exponential backoff delay
function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Helper function to create abort timeout
function createTimeout(ms: number): AbortController {
  const controller = new AbortController();
  setTimeout(() => controller.abort(), ms);
  return controller;
}

export interface ApiRequestConfig {
  url: string;
  method?: "GET" | "POST" | "PUT" | "DELETE" | "PATCH";
  data?: any;
  requiresAuth?: boolean;
  retries?: number; // Current retry count (internal)
}

async function fetchWithTimeout(
  url: string,
  options: RequestInit,
  timeoutMs: number
): Promise<Response> {
  const timeoutController = createTimeout(timeoutMs);

  try {
    const response = await fetch(url, {
      ...options,
      signal: timeoutController.signal,
    });
    return response;
  } catch (error: any) {
    if (error.name === 'AbortError') {
      throw new Error(`Request timeout after ${timeoutMs}ms`);
    }
    throw error;
  }
}

// In production, use Next.js rewrites for all API calls to ensure proper cookie handling
// This avoids CORS issues and ensures cookies are sent correctly
const API_BASE = "/api"; // All API calls go through Next.js proxy/rewrites

export const apiClientFn = async ({
  url,
  method = "GET",
  data,
  requiresAuth = true,
  retries = 0,
}: ApiRequestConfig) => {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  // All API calls go through Next.js to ensure cookies work correctly
  // The Next.js rewrites in next.config.ts handle forwarding to the backend
  const requestUrl = url.startsWith("/") ? url : `${API_BASE}${url}`;

  // JWT token is stored in httpOnly cookie
  // Browser sends it automatically, no need to add Authorization header
  try {
    const response = await fetchWithTimeout(
      requestUrl,
      {
        method,
        headers,
        ...(data && { body: JSON.stringify(data) }),
        credentials: 'include', // Important: include cookies
      },
      TIMEOUT_MS
    );

    if (!response.ok) {
      if (response.status === 401) {
        // Unauthorized - redirect to login
        window.location.href = "/login";
        throw new Error("Unauthorized");
      }

      // Retry on network errors or 5xx server errors (but not 4xx client errors)
      const isRetryable =
        response.status >= 500 ||
        response.status === 0 || // Network error
        response.statusText === 'Network Error' ||
        response.statusText === 'Service Unavailable';

      if (isRetryable && retries < MAX_RETRIES) {
        // Exponential backoff: wait 2^retry_count seconds
        const backoffDelay = BASE_DELAY_MS * Math.pow(2, retries);
        console.warn(`Request failed, retrying in ${backoffDelay}ms... (attempt ${retries + 1}/${MAX_RETRIES})`);

        await delay(backoffDelay);

        // Retry the request
        return apiClientFn({
          url,
          method,
          data,
          requiresAuth,
          retries: retries + 1,
        });
      }

      throw new Error(`API Error: ${response.status} ${response.statusText}`);
    }

    return response.json();
  } catch (error: any) {
    // Retry on network errors (timeout, connection refused, etc.)
    if (
      error.message.includes('timeout') ||
      error.message.includes('Network Error') ||
      error.message.includes('Failed to fetch')
    ) {
      if (retries < MAX_RETRIES) {
        const backoffDelay = BASE_DELAY_MS * Math.pow(2, retries);
        console.warn(`Network error, retrying in ${backoffDelay}ms... (attempt ${retries + 1}/${MAX_RETRIES})`);

        await delay(backoffDelay);

        return apiClientFn({
          url,
          method,
          data,
          requiresAuth,
          retries: retries + 1,
        });
      }
    }

    throw error;
  }
};

// Task service with typed methods
export const taskService = {
  getTasks: () => apiClientFn({ url: "/api/tasks" }),

  getTask: (id: string) =>
    apiClientFn({ url: `/api/tasks/${id}` }),

  createTask: (task: { title: string; description?: string }) =>
    apiClientFn({
      url: "/api/tasks",
      method: "POST",
      data: task,
    }),

  updateTask: (id: string, updates: any) =>
    apiClientFn({
      url: `/api/tasks/${id}`,
      method: "PUT",
      data: updates,
    }),

  deleteTask: (id: string) =>
    apiClientFn({
      url: `/api/tasks/${id}`,
      method: "DELETE",
    }),

  toggleComplete: (id: string) =>
    apiClientFn({
      url: `/api/tasks/${id}/complete`,
      method: "PATCH",
    }),
};