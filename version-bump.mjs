import {readFileSync, writeFileSync} from "fs";

const targetVersion = process.env.npm_package_version;
if (!targetVersion) {
	throw new Error("npm_package_version is not set");
}

// Read minAppVersion from manifest.json and bump version to target version.
const manifest = JSON.parse(readFileSync("manifest.json", "utf8"));
const {minAppVersion} = manifest;
manifest.version = targetVersion;
writeFileSync("manifest.json", JSON.stringify(manifest, null, "\t"));

// Update versions.json for this exact target version.
const versions = JSON.parse(readFileSync("versions.json", "utf8"));
versions[targetVersion] = minAppVersion;
writeFileSync("versions.json", JSON.stringify(versions, null, "\t"));
