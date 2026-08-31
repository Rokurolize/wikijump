import importlib.util
from pathlib import Path
import unittest


SCRIPT = Path(__file__).parents[1] / "scripts/check-xmlrpc-url-swap.py"
SPEC = importlib.util.spec_from_file_location("check_xmlrpc_url_swap", SCRIPT)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(MODULE)


class XmlrpcEndpointTest(unittest.TestCase):
    def test_loopback_endpoint_receives_encoded_credentials(self):
        self.assertEqual(
            MODULE.authenticated_endpoint(
                "http://127.0.0.1:8080/xml-rpc-api.php",
                "user@example",
                "p@ss",
            ),
            "http://user%40example:p%40ss@127.0.0.1:8080/xml-rpc-api.php",
        )

    def test_non_loopback_endpoint_is_rejected_before_credentials_are_bound(self):
        with self.assertRaisesRegex(MODULE.ConformanceError, "loopback host"):
            MODULE.authenticated_endpoint(
                "http://attacker.example/xml-rpc-api.php",
                "user",
                "password",
            )


if __name__ == "__main__":
    unittest.main()
