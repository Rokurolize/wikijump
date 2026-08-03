use http::header::{AUTHORIZATION, HeaderMap, WWW_AUTHENTICATE};
use http::{Request, Response, StatusCode};
use jsonrpsee::server::HttpBody;
use sha2::{Digest, Sha256};
use std::fmt;
use std::future::Future;
use std::pin::Pin;
use std::task::{Context, Poll};
use subtle::ConstantTimeEq;
use tower::{Layer, Service};

const TOKEN_HEX_LENGTH: usize = 64;

#[derive(Clone)]
pub struct RpcTokenDigest([u8; 32]);

impl RpcTokenDigest {
    pub fn parse(token: &str) -> Result<Self, &'static str> {
        if !valid_token(token) {
            return Err(
                "DEEPWELL_RPC_TOKEN must be exactly 64 lowercase hexadecimal characters",
            );
        }
        Ok(Self(Sha256::digest(token.as_bytes()).into()))
    }
}

impl fmt::Debug for RpcTokenDigest {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("RpcTokenDigest([REDACTED])")
    }
}

fn valid_token(token: &str) -> bool {
    token.len() == TOKEN_HEX_LENGTH
        && token
            .as_bytes()
            .iter()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(byte))
}

fn authorized(headers: &HeaderMap, expected: &RpcTokenDigest) -> bool {
    let mut values = headers.get_all(AUTHORIZATION).iter();
    let Some(value) = values.next() else {
        return false;
    };
    if values.next().is_some() {
        return false;
    }
    let Ok(value) = value.to_str() else {
        return false;
    };
    let Some(token) = value.strip_prefix("Bearer ") else {
        return false;
    };
    if !valid_token(token) {
        return false;
    }
    let actual: [u8; 32] = Sha256::digest(token.as_bytes()).into();
    bool::from(expected.0.ct_eq(&actual))
}

fn unauthorized() -> Response<HttpBody> {
    let mut response = Response::new(HttpBody::from("Unauthorized"));
    *response.status_mut() = StatusCode::UNAUTHORIZED;
    response
        .headers_mut()
        .insert(WWW_AUTHENTICATE, "Bearer".parse().unwrap());
    response
}

#[derive(Debug, Clone)]
pub struct RpcAuthLayer {
    expected: RpcTokenDigest,
}

impl RpcAuthLayer {
    pub fn new(expected: RpcTokenDigest) -> Self {
        Self { expected }
    }
}

impl<S> Layer<S> for RpcAuthLayer {
    type Service = RpcAuthService<S>;

    fn layer(&self, inner: S) -> Self::Service {
        RpcAuthService {
            inner,
            expected: self.expected.clone(),
        }
    }
}

#[derive(Debug, Clone)]
pub struct RpcAuthService<S> {
    inner: S,
    expected: RpcTokenDigest,
}

impl<S, Body> Service<Request<Body>> for RpcAuthService<S>
where
    S: Service<Request<Body>, Response = Response<HttpBody>>,
    S::Future: Send + 'static,
    S::Error: Send + 'static,
    Body: Send + 'static,
{
    type Response = S::Response;
    type Error = S::Error;
    type Future =
        Pin<Box<dyn Future<Output = Result<Self::Response, Self::Error>> + Send>>;

    fn poll_ready(&mut self, cx: &mut Context<'_>) -> Poll<Result<(), Self::Error>> {
        self.inner.poll_ready(cx)
    }

    fn call(&mut self, request: Request<Body>) -> Self::Future {
        if authorized(request.headers(), &self.expected) {
            Box::pin(self.inner.call(request))
        } else {
            Box::pin(async { Ok(unauthorized()) })
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::convert::Infallible;
    use std::sync::Arc;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::task::Poll;

    const TOKEN: &str =
        "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

    #[derive(Clone)]
    struct CountingService(Arc<AtomicUsize>);

    impl Service<Request<()>> for CountingService {
        type Response = Response<HttpBody>;
        type Error = Infallible;
        type Future = std::future::Ready<Result<Self::Response, Self::Error>>;

        fn poll_ready(&mut self, _: &mut Context<'_>) -> Poll<Result<(), Self::Error>> {
            Poll::Ready(Ok(()))
        }

        fn call(&mut self, _: Request<()>) -> Self::Future {
            self.0.fetch_add(1, Ordering::SeqCst);
            std::future::ready(Ok(Response::new(HttpBody::empty())))
        }
    }

    fn request(value: Option<&str>) -> Request<()> {
        let mut request = Request::new(());
        if let Some(value) = value {
            request
                .headers_mut()
                .append(AUTHORIZATION, value.parse().unwrap());
        }
        request
    }

    #[tokio::test]
    async fn rejects_invalid_credentials_before_dispatch() {
        let dispatches = Arc::new(AtomicUsize::new(0));
        let expected = RpcTokenDigest::parse(TOKEN).unwrap();
        let invalid = [
            None,
            Some(TOKEN),
            Some("Basic 0123456789abcdef"),
            Some(
                "Bearer 0123456789ABCDEF0123456789abcdef0123456789abcdef0123456789abcdef",
            ),
            Some(
                "Bearer ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
            ),
        ];

        for value in invalid {
            let mut service = RpcAuthLayer::new(expected.clone())
                .layer(CountingService(Arc::clone(&dispatches)));
            let response = service.call(request(value)).await.unwrap();
            assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
            assert_eq!(response.headers()[WWW_AUTHENTICATE], "Bearer");
        }

        let mut duplicate = request(Some(&format!("Bearer {TOKEN}")));
        duplicate
            .headers_mut()
            .append(AUTHORIZATION, format!("Bearer {TOKEN}").parse().unwrap());
        let mut service = RpcAuthLayer::new(expected.clone())
            .layer(CountingService(Arc::clone(&dispatches)));
        assert_eq!(
            service.call(duplicate).await.unwrap().status(),
            StatusCode::UNAUTHORIZED
        );
        assert_eq!(dispatches.load(Ordering::SeqCst), 0);

        let mut service =
            RpcAuthLayer::new(expected).layer(CountingService(Arc::clone(&dispatches)));
        assert_eq!(
            service
                .call(request(Some(&format!("Bearer {TOKEN}"))))
                .await
                .unwrap()
                .status(),
            StatusCode::OK
        );
        assert_eq!(dispatches.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn token_format_and_debug_output_are_safe() {
        let digest = RpcTokenDigest::parse(TOKEN).unwrap();
        assert_eq!(format!("{digest:?}"), "RpcTokenDigest([REDACTED])");
        for invalid in ["", "abc", &TOKEN.to_uppercase(), &format!("{TOKEN}0")] {
            assert!(RpcTokenDigest::parse(invalid).is_err());
        }
    }
}
