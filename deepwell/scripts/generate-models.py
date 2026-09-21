#!/usr/bin/env python3

from glob import iglob
import os
from io import StringIO
import re
import subprocess
import sys

DATABASE_URL = "postgres://wikijump:wikijump@localhost/wikijump"
MODELS_DIRECTORY = "src/models"

# For serializing timestamp fields
TIMESTAMP_ATTRIBUTE = "time::serde::rfc3339"
OPTION_TIMESTAMP_ATTRIBUTE = "time::serde::rfc3339::option"
TIMESTAMP_FIELD_REGEX = re.compile(r"( *)pub ([^:]+): TimeDateTimeWithTimeZone,\n")
OPTION_TIMESTAMP_FIELD_REGEX = re.compile(
    r"( *)pub ([^:]+): Option<TimeDateTimeWithTimeZone>,\n",
)

# For using our enums for column types
FIELD_REGEX = re.compile(r"( *)pub ([^:]+): ([^,]+),\n")
SEA_ORM_TEXT_ATTRIBUTE_REGEX = re.compile(r"( *)#\[sea_orm\((.+)\)\]")
SEA_ORM_TEXT_ATTRIBUTE_ITEM = 'column_type = "Text"'


def chdir_to_crate_root():
    print("Changing directory to deepwell")
    this_script = os.path.abspath(sys.argv[0])
    crate_root = os.path.dirname(os.path.dirname(this_script))
    os.chdir(crate_root)


def remove_existing_models():
    if os.path.isdir(MODELS_DIRECTORY):
        for path in iglob(os.path.join(MODELS_DIRECTORY, "*.rs")):
            print(f"Deleting {path}")
            os.remove(path)


def run_sea_orm_cli():
    print("Running sea-orm-cli generate entity")
    subprocess.check_call(
        [
            "sea-orm-cli",
            "generate",
            "entity",
            "--verbose",
            "--date-time-crate",
            "time",
            "--with-serde",
            "both",
            "--enum-extra-attributes",
            'serde(rename_all = "kebab-case")',
            "--with-copy-enums",
            "--database-url",
            DATABASE_URL,
            "--output-dir",
            MODELS_DIRECTORY,
        ]
    )


class ModelFileRewriter:
    __slots__ = ("path", "filename", "table_name", "lines", "modified")

    def __init__(self, path):
        self.path = path
        self.filename = os.path.basename(path)
        self.table_name, _ = os.path.splitext(self.filename)

        with open(self.path) as file:
            self.lines = file.readlines()
            self.modified = False

    @property
    def line_iter(self):
        return enumerate(self.lines)

    def rewrite(self):
        # We're making these separate methods for readability
        #
        # Sure it would be faster to do it all in one pass,
        # but given that this script is run on-demand as part
        # of development, it is not part of any hot path.
        self.insert_timestamp_fields()
        self.replace_enum_types()

    def save(self):
        if self.modified:
            print(f"Rewriting {self.filename}")
            with open(self.path, "w") as file:
                file.writelines(self.lines)
                self.modified = False

    ## SPECIFIC REWRITE RULES ##

    def insert_timestamp_fields(self):
        def find_regex_match(line):
            PATTERNS = [
                (TIMESTAMP_FIELD_REGEX, TIMESTAMP_ATTRIBUTE),
                (OPTION_TIMESTAMP_FIELD_REGEX, OPTION_TIMESTAMP_ATTRIBUTE),
            ]

            for regex, attribute in PATTERNS:
                match = regex.match(line)
                if match is not None:
                    indent = match[1]
                    return indent, attribute

            return None

        lines_to_insert = []  # (index, line)
        for idx, line in self.line_iter:
            match find_regex_match(line):
                case indent, attribute:
                    # Prepare #[serde] for insertion immediately before the matched field.
                    serde_line = f'{indent}#[serde(with = "{attribute}")]\n'
                    lines_to_insert.append((idx, serde_line))

        # Insert the lines in reverse order to not mess up indices
        for idx, line in reversed(lines_to_insert):
            self.lines.insert(idx, line)
        if lines_to_insert:
            self.modified = True

    def replace_enum_types(self):
        types_to_import = set()
        lines_to_change = []  # (index, line), where None means delete
        for idx, line in self.line_iter:
            match = FIELD_REGEX.match(line)
            if match is None:
                # Not a column
                continue

            indent, column_name, column_type = match.groups()
            match self.filename, column_name:
                case _, "action":
                    rust_type = "Action"
                case _, "alias_type":
                    rust_type = "AliasType"
                case _, "block_type":
                    rust_type = "TextBlockType"
                case _, "connection_type":
                    rust_type = "ConnectionType"
                case "relation.rs", "dest_type":
                    rust_type = "RelationObjectType"
                case "relation.rs", "from_type":
                    rust_type = "RelationObjectType"
                case _, "license":
                    rust_type = "License"
                case _, "recipient_type":
                    rust_type = "MessageRecipientType"
                case _, "relation_type":
                    rust_type = "RelationType"
                case _, "resource_type":
                    rust_type = "Resource"
                case "file_revision.rs", "revision_type":
                    rust_type = "FileRevisionType"
                case "page_revision.rs", "revision_type":
                    rust_type = "PageRevisionType"
                case _, "user_type":
                    rust_type = "UserType"
                case "page_lock.rs", "lock_type":
                    rust_type = "PageLockType"

                # Not an enum type we need to map
                case _:
                    continue

            if column_type != "String":
                message = f"Found column '{column_name}' of type '{column_type}', but this should be mapped to enum '{rust_type}'"
                raise ValueError(message)

            types_to_import.add(rust_type)

            # Rewrite or remove #[sea_orm] thing on prior line
            sea_orm_attrib_line = self.strip_column_type_from_sea_orm(
                self.lines[idx - 1],
                column_name,
            )
            lines_to_change.append((idx - 1, sea_orm_attrib_line))

            # Rewrite field definition to use rust enum type
            new_line = f"{indent}pub {column_name}: {rust_type},\n"
            lines_to_change.append((idx, new_line))

        # If no types detected, nothing to do
        if not types_to_import:
            return

        self.modified = True
        # Apply line changes in reverse order so earlier indices remain valid.
        for idx, line in reversed(lines_to_change):
            if line is None:
                del self.lines[idx]
            else:
                self.lines[idx] = line

        # Add the import line with our enum types
        import_index = self.find_start_of_import_block()
        import_line = self.format_use_block(types_to_import)
        self.lines.insert(import_index, import_line)

    def strip_column_type_from_sea_orm(self, line, column_name):
        match = SEA_ORM_TEXT_ATTRIBUTE_REGEX.match(line)
        if match is None:
            message = f"No #[sea_orm] attribute on previous line from enum type {column_name} in {self.filename}"
            raise ValueError(message)

        indent = match[1]
        attributes = match[2].split(", ")
        attributes.remove(SEA_ORM_TEXT_ATTRIBUTE_ITEM)

        if attributes:
            # There are still items left, like #[sea_orm(primary_key, auto_increment = false)]
            # So return a modified line
            return f"{indent}#[sea_orm({', '.join(attributes)})]\n"
        else:
            # There are no items left, so remove the line entirely
            return None

    def find_start_of_import_block(self):
        for idx, line in self.line_iter:
            if line.startswith("use"):
                return idx

        raise ValueError("No import block found in entity file")

    def format_use_block(self, types):
        if len(types) == 1:
            the_type = next(iter(types))  # the one and only
            return f"use crate::types::{the_type};\n"
        else:
            return f"use crate::types::{{{', '.join(sorted(types))}}};\n"

    def apply_patches(self):
        # This is due to https://github.com/SeaQL/sea-orm/issues/2358
        # sea-orm-cli is not generating relations properly, so we have a manual patch to fix it

        # Because this modifies the file on-disk, we have to ensure it's fully written out first
        if self.modified:
            message = f"Cannot patch {self.filename}, there are unwritten changes pending!"
            raise ValueError(message)

        # This programmatically checks for a patch file, and if it exists, applies it
        # for this model file.
        filename = f"{self.filename}.patch"
        patch_path = os.path.join(MODELS_DIRECTORY, filename)
        if os.path.isfile(patch_path):
            print(f"Applying {filename} to {self.filename}")
            subprocess.check_call(
                [
                    "patch",
                    self.path,
                    patch_path,
                ]
            )


if __name__ == "__main__":
    chdir_to_crate_root()
    remove_existing_models()
    run_sea_orm_cli()

    for path in iglob(os.path.join(MODELS_DIRECTORY, "*.rs")):
        if os.path.basename(path) == "mod.rs":
            # Not an entity file corresponding to a table
            continue

        model = ModelFileRewriter(path)
        model.rewrite()
        model.save()
        model.apply_patches()
