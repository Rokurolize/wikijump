import pathlib
import re
import tomllib
import unittest


KOMODO_ROOT = pathlib.Path(__file__).resolve().parent.parent
REPOSITORY_ROOT = KOMODO_ROOT.parents[2]
EXPECTED_STACK_VARIABLES = {
    "DEEPWELL_RPC_TOKEN",
    "POSTGRES_PASSWORD",
    "S3_FILES_BUCKET",
    "S3_TEXT_BLOCKS_BUCKET",
    "S3_CUSTOM_ENDPOINT",
    "S3_REGION_NAME",
    "S3_PATH_STYLE",
    "S3_ACCESS_KEY_ID",
    "S3_SECRET_ACCESS_KEY",
    "MAILJET_API_KEY",
    "MAILJET_SECRET_KEY",
    "DIGITALOCEAN_API_TOKEN",
}


class KomodoVariablePolicyTests(unittest.TestCase):
    def test_variables_file_is_not_tracked_or_available_to_resource_sync(self):
        self.assertFalse(
            (KOMODO_ROOT / "variables.toml").exists(),
            "deployment variables belong in Komodo's secret store, not the checkout",
        )

    def test_stack_placeholders_are_named_runtime_variables(self):
        with (KOMODO_ROOT / "stacks.toml").open("rb") as handle:
            environment = tomllib.load(handle)["stack"][0]["config"]["environment"]

        placeholders = set(re.findall(r"\[\[([A-Z][A-Z0-9_]*)\]\]", environment))
        self.assertNotIn("[[", re.sub(r"\[\[[A-Z][A-Z0-9_]*\]\]", "", environment))
        self.assertEqual(placeholders, EXPECTED_STACK_VARIABLES)

    def test_bootstrap_import_policy_is_one_time_and_scoped(self):
        with (KOMODO_ROOT / "resource-sync.toml").open("rb") as handle:
            resource_sync = tomllib.load(handle)["resource_sync"][0]["config"]
        documentation = (REPOSITORY_ROOT / "docs/deployment/dev.md").read_text()

        self.assertEqual(
            resource_sync["resource_path"],
            [
                "install/dev/komodo/alerters.toml",
                "install/dev/komodo/builder.toml",
                "install/dev/komodo/docker-compose.yaml",
                "install/dev/komodo/procedures.toml",
                "install/dev/komodo/resource-sync.toml",
                "install/dev/komodo/servers.toml",
                "install/dev/komodo/sources.toml",
                "install/dev/komodo/stacks.toml",
                "install/dev/komodo/system.toml",
            ],
        )
        self.assertNotIn("variables.toml", resource_sync["resource_path"])
        enable = documentation.index('set "Sync Variables" to true')
        disable = documentation.index('Set "Sync Variables" back to false')
        self.assertLess(enable, disable)


if __name__ == "__main__":
    unittest.main()
