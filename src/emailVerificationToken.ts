let capturedToken = "";

function captureFromLocation() {
  if (window.location.pathname !== "/verify-email") return;
  const url = new URL(window.location.href);
  const token = url.searchParams.get("token") ?? "";
  if (!token) return;
  capturedToken = token;
  url.searchParams.delete("token");
  window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
}

captureFromLocation();

export function readEmailVerificationToken() {
  if (!capturedToken) captureFromLocation();
  return capturedToken;
}

export function forgetEmailVerificationToken() {
  capturedToken = "";
}
