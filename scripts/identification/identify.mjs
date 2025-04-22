import crypto from "node:crypto";
import fs from "node:fs/promises";

import { File, LanguagePicker } from "@dodona/dolos-lib";
import { deserializeFingerprintIndex } from "./dolos-serializer.mjs";
import { findStrings } from "./find_candidate_strings.mjs";
import identifyBundler, { parseLoose } from "./identify_bundler.mjs";
import {
    extractGroupedNpmModules,
    identifyBrowserifyParcelCompartments,
    identifyEsbuildBunCompartments,
    identifyWebpackChunkCompartments,
    identifyWebpackCompartments,
} from "./identify_compartments.mjs";
import { identifyLibrariesByStrings, identifyLibrariesByStringsWithCompartments } from "./identify_libraries.mjs";
import { MightBeJsonError } from "./utils.mjs";

const languagePicker = new LanguagePicker();
const javascript = await languagePicker.findLanguage("javascript");

const tokenizer = await javascript.createTokenizer();

export async function useCachedIndex(indexFiles, bundle) {
    const bundleTf = tokenizer.tokenizeFile(new File("bundle", bundle));
    const allSimilarities = {};

    for (const indexFile of indexFiles) {
        const similarities = [];
        try {
            const data = await fs.readFile(indexFile, { encoding: "utf8" }).then(JSON.parse);
            const index = deserializeFingerprintIndex(data);
            const tokenizedFiles = index.entries().map((entry) => entry.file);

            index.addFiles([bundleTf]);

            for (let i = 0; i < tokenizedFiles.length; i++) {
                const pair = index.getPair(bundleTf, tokenizedFiles[i]);
                similarities.push({
                    name: tokenizedFiles[i].path,
                    similarity: {
                        leftCovered: pair.leftCovered,
                        leftTotal: pair.leftTotal,
                        rightCovered: pair.rightCovered,
                        rightTotal: pair.rightTotal,
                        longest: pair.longest,
                    },
                });
            }
        } catch (e) {
            // If no index file is found return empty array
            console.log("Index not found", indexFile);
            console.log(`${e}`);
        }
        allSimilarities[indexFile] = similarities;
    }

    return allSimilarities;
}

/**
 * Fetch all versions as found by pnpm source file names
 *
 * @param {string} rawMap Source map as string
 * @returns {string[]} Array of pkg@vers
 */
function fetchPnpmVersions(rawMap) {
    let versions = [];
    try {
        const map = JSON.parse(rawMap);
        const pnpmMatcher = new RegExp(/\/.pnpm\/(?<version>[^\/]+@[^\/@]+)\/node_modules/);
        versions =
            map.sources
                ?.map((path) => pnpmMatcher.exec(path)?.groups.version)
                .filter((v) => !!v)
                .flatMap((v) => v.split("_"))
                .filter((v) => !!v)
                .map((p) => p.replace("+", "/")) ?? [];
    } catch (e) {
        // ignore
    }
    // Deduplicate
    return [...new Set(versions)];
}

/**
 * Fetch all libraries as found by npm source file names
 *
 * @param {string} rawMap Source map as string
 * @returns {string[]} Array of @scope/pkg
 */
function fetchNpmLibraries(rawMap) {
    let libraries = [];
    try {
        const map = JSON.parse(rawMap);
        const nodeModulesMatcher = new RegExp(/\/node_modules\/(?<library>(@[^\/@]+\/)?[^\/@]+)/g);
        const findAllMatches = (haystack, pattern) => {
            pattern.lastIndex = 0;
            const m = [];
            do {
                m.push(pattern.exec(haystack)?.groups.library);
            } while (m[m.length - 1]);
            return m.slice(0, -1);
        };

        libraries = map.sources
            .map((path) => findAllMatches(path, nodeModulesMatcher))
            .flat()
            .filter((v) => !!v);
    } catch (e) {
        // ignore
    }
    // Deduplicate
    return [...new Set(libraries)];
}

async function main() {
    if (!process.env.INDEX_DIR) {
        console.error("ERROR: Missing environment variable INDEX_DIR");
        return;
    }

    const indexDir = process.env.INDEX_DIR;

    let stringFingerprints;

    if (typeof Bun === "undefined") {
        var Bun = (await import("../bun-serve.mjs")).default;
    }

    Bun.serve({
        port: process.env.PORT,
        /** @param {Request} request
         *  @param {any} server */
        fetch: async (request, server) => {
            try {
                const url = new URL(request.url);
                const body = JSON.parse(await request.text());
                const compartmentIdentification = {
                    webpack: identifyWebpackCompartments,
                    webpackChunk: identifyWebpackChunkCompartments,
                    browserify: identifyBrowserifyParcelCompartments,
                    bun: identifyEsbuildBunCompartments,
                    esbuild: identifyEsbuildBunCompartments,
                    parcel: identifyBrowserifyParcelCompartments,
                };

                const wantsPnpm = Boolean(request.headers.get("X-Wants-Pnpm"));

                switch (url.pathname) {
                    case "/alive":
                        return new Response("", { status: 200, statusText: "OK" });
                    case "/identify":
                    case "/identify/combined/compartments": {
                        const { source, map } = body;
                        const bundlers = [...new Set(identifyBundler(source, map).map((b) => b[0]))].filter(
                            (b) => compartmentIdentification[b],
                        );
                        const { modules } =
                            bundlers.length > 0 ? compartmentIdentification[bundlers[0]](source, map) : { modules: {} };
                        const groundTruth = fetchPnpmVersions(map);
                        if (wantsPnpm && groundTruth.length === 0) {
                            return new Response(JSON.stringify({ libraries: [], similarities: {}, groundTruth }), {
                                status: 200,
                                statusText: "OK",
                                headers: { "content-type": "application/json" },
                            });
                        }
                        const libraries = await identifyLibrariesByStringsWithCompartments(source, modules);
                        const nodeModules = extractGroupedNpmModules(modules);

                        const similarities = await Promise.all(
                            libraries.map((pkg) =>
                                useCachedIndex(
                                    [`${indexDir}/${pkg.replace("/", "+")}.index.json`],
                                    nodeModules[pkg] ? nodeModules[pkg][1] : source,
                                ),
                            ),
                        );
                        return new Response(JSON.stringify({ libraries, similarities, groundTruth }), {
                            status: 200,
                            statusText: "OK",
                            headers: { "content-type": "application/json" },
                        });
                    }
                    case "/identify/combined/no_compartments": {
                        const { source, map } = body;
                        const groundTruth = fetchPnpmVersions(map);
                        if (wantsPnpm && groundTruth.length === 0) {
                            return new Response(JSON.stringify({ libraries: [], similarities: {}, groundTruth }), {
                                status: 200,
                                statusText: "OK",
                                headers: { "content-type": "application/json" },
                            });
                        }
                        const libraries = await identifyLibrariesByStrings(source);
                        const similarities = await Promise.all(
                            libraries
                                .map((pkgVers) => pkgVers.rsplit(",", 1)[0])
                                .map((pkg) =>
                                    useCachedIndex([`${indexDir}/${pkg.replace("/", "+")}.index.json`], source),
                                ),
                        );
                        return new Response(JSON.stringify({ libraries, similarities, groundTruth }), {
                            status: 200,
                            statusText: "OK",
                            headers: { "content-type": "application/json" },
                        });
                    }
                    case "/identify/versions/compartments": {
                        const { source, map } = body;
                        const groundTruth = fetchPnpmVersions(map);
                        if (wantsPnpm && groundTruth.length === 0) {
                            return new Response(
                                JSON.stringify({ dependencies: [], similarities: {}, modules: {}, groundTruth }),
                                {
                                    status: 200,
                                    statusText: "OK",
                                    headers: { "content-type": "application/json" },
                                },
                            );
                        }
                        const bundlers = [...new Set(identifyBundler(source, map).map((b) => b[0]))].filter(
                            (b) => compartmentIdentification[b],
                        );
                        const { modules, dependencies } =
                            bundlers.length > 0
                                ? compartmentIdentification[bundlers[0]](source, map)
                                : {
                                      modules: {},
                                      dependencies: [],
                                  };
                        const nodeModules = extractGroupedNpmModules(modules);
                        Object.values(modules).forEach((m) => (delete m.ast, delete m.text));
                        const similarities = await Promise.all(
                            Object.entries(nodeModules).map((nm) =>
                                useCachedIndex([`${indexDir}/${nm[0].replace("/", "+")}.index.json`], nm[1]),
                            ),
                        );
                        return new Response(JSON.stringify({ similarities, modules, dependencies, groundTruth }), {
                            status: 200,
                            statusText: "OK",
                            headers: { "content-type": "application/json" },
                        });
                    }
                    case "/identify/versions/no_compartments": {
                        const { source, map } = body;
                        const groundTruth = fetchPnpmVersions(map);
                        if (wantsPnpm && groundTruth.length === 0) {
                            return new Response(JSON.stringify({ similarities: {}, groundTruth }), {
                                status: 200,
                                statusText: "OK",
                                headers: { "content-type": "application/json" },
                            });
                        }
                        const similarities = await Promise.all(
                            groundTruth
                                .map((pkgVers) => pkgVers.rsplit("@", 1)[0])
                                .map((pkg) =>
                                    useCachedIndex([`${indexDir}/${pkg.replace("/", "+")}.index.json`], source),
                                ),
                        );
                        return new Response(JSON.stringify({ similarities, groundTruth }), {
                            status: 200,
                            statusText: "OK",
                            headers: { "content-type": "application/json" },
                        });
                    }
                    case "/identify/bundler":
                        const { source, map } = body;
                        return new Response(JSON.stringify(identifyBundler(source, map)), {
                            status: 200,
                            statusText: "OK",
                            headers: { "content-type": "application/json" },
                        });
                    case "/identify/libraries/strings": {
                        const { source, map } = body;
                        const groundTruth = fetchNpmLibraries(map);
                        if (!stringFingerprints) {
                            stringFingerprints = new Set(
                                Object.keys(
                                    JSON.parse(
                                        await fs.readFile(
                                            process.env.STRING_FINGERPRINT_DB ?? "fingerprint_strings.json",
                                            { encoding: "utf8" },
                                        ),
                                    ),
                                ),
                            );
                            console.log("Length of fingerprint DB: ", stringFingerprints.size);
                        }
                        const strings = [...new Set(findStrings(parseLoose(source)))];
                        const matchedFingerprints = strings
                            .map((s) => crypto.hash("md5", s))
                            .filter((h) => stringFingerprints.has(h));
                        return new Response(JSON.stringify({ matchedFingerprints, groundTruth }), {
                            status: 200,
                            statusText: "OK",
                            headers: { "content-type": "application/json" },
                        });
                    }
                    case "/identify/libraries/strings/bycompartment": {
                        const { source, map } = body;
                        const groundTruth = fetchNpmLibraries(map);
                        const bundlers = [...new Set(identifyBundler(source, map).map((b) => b[0]))].filter(
                            (b) => compartmentIdentification[b],
                        );
                        const { modules, dependencies } =
                            bundlers.length > 0
                                ? compartmentIdentification[bundlers[0]](source, map)
                                : {
                                      modules: {},
                                      dependencies: [],
                                  };

                        if (!stringFingerprints) {
                            stringFingerprints = new Set(
                                Object.keys(
                                    JSON.parse(
                                        await fs.readFile(
                                            process.env.STRING_FINGERPRINT_DB ?? "fingerprint_strings.json",
                                            { encoding: "utf8" },
                                        ),
                                    ),
                                ),
                            );
                            console.log("Length of fingerprint DB: ", stringFingerprints.size);
                        }

                        if (Object.keys(modules).length > 0) {
                            const matchedFingerprints = {};
                            for (const [id, module] of Object.entries(modules)) {
                                const strings = [...new Set(findStrings(module.ast))];
                                matchedFingerprints[id] = strings
                                    .map((s) => crypto.hash("md5", s))
                                    .filter((h) => stringFingerprints.has(h));
                            }
                            return new Response(JSON.stringify({ matchedFingerprints, groundTruth }), {
                                status: 200,
                                statusText: "OK",
                                headers: { "content-type": "application/json" },
                            });
                        } else {
                            // Unknown bundle structure
                            const strings = [...new Set(findStrings(parseLoose(source)))];
                            const matchedFingerprints = {
                                main: strings
                                    .map((s) => crypto.hash("md5", s))
                                    .filter((h) => stringFingerprints.has(h)),
                            };
                            return new Response(JSON.stringify({ matchedFingerprints, groundTruth }), {
                                status: 200,
                                statusText: "OK",
                                headers: { "content-type": "application/json" },
                            });
                        }
                    }
                    case "/identify/bundler-compartments": {
                        const { source, map } = body;
                        const bundlers = identifyBundler(source, map);
                        const bundler = (bundlers[0] ?? [])[0];
                        if (!compartmentIdentification[bundler]) {
                            return new Response(JSON.stringify({}), {
                                status: 200,
                                statusText: "OK",
                                headers: { "content-type": "application/json" },
                            });
                        }
                        const { dependencies, modules } = compartmentIdentification[bundler](source, map);
                        for (const m in modules) {
                            delete modules[m].ast;
                            delete modules[m].text;
                        }
                        return new Response(JSON.stringify({ bundler, modules, dependencies }), {
                            status: 200,
                            statusText: "OK",
                            headers: { "content-type": "application/json" },
                        });
                    }
                    case "/identify/compartments": {
                        const { bundler, source, map } = body;
                        if (!compartmentIdentification[bundler])
                            return new Response(
                                `Available bundlers: ${Object.keys(compartmentIdentification).join(", ")}`,
                                { status: 400, statusText: "Bundler not supported" },
                            );
                        const { dependencies, modules } = compartmentIdentification[bundler](source, map);
                        for (const m in modules) {
                            delete modules[m].ast;
                            delete modules[m].text;
                        }
                        return new Response(JSON.stringify({ modules, dependencies }), {
                            status: 200,
                            statusText: "OK",
                            headers: { "content-type": "application/json" },
                        });
                    }
                    case "/identify/without_truths/compartments": {
                        const { source, map } = body;

                        // Check if map is usable
                        let mapUsable = true;
                        try {
                            const data = JSON.parse(map);
                            if (!data.sources?.length) {
                                mapUsable = false;
                            }
                        } catch (e) {
                            mapUsable = false;
                        }

                        let libraries = [];
                        let similarities = [];

                        const bundlers = [
                            ...new Set(identifyBundler(source, mapUsable ? map : undefined).map((b) => b[0])),
                        ].filter((b) => compartmentIdentification[b]);
                        const { modules } =
                            bundlers.length > 0
                                ? compartmentIdentification[bundlers[0]](source, mapUsable ? map : undefined)
                                : { modules: {} };
                        const nodeModules = extractGroupedNpmModules(modules);

                        if (mapUsable) {
                            Object.values(modules).forEach((m) => (delete m.ast, delete m.text));
                            libraries = Object.keys(modules);
                            similarities = await Promise.all(
                                Object.entries(nodeModules).map((nm) =>
                                    useCachedIndex([`${indexDir}/${nm[0].replace("/", "+")}.index.json`], nm[1]),
                                ),
                            );
                        } else {
                            libraries = await identifyLibrariesByStringsWithCompartments(source, modules);
                            similarities = await Promise.all(
                                libraries.map((pkg) =>
                                    useCachedIndex(
                                        [`${indexDir}/${pkg.replace("/", "+")}.index.json`],
                                        nodeModules[pkg] ? nodeModules[pkg][1] : source,
                                    ),
                                ),
                            );
                        }

                        return new Response(
                            JSON.stringify({ similarities, libraries: Object.entries(nodeModules), mapUsable }),
                            {
                                status: 200,
                                statusText: "OK",
                                headers: { "content-type": "application/json" },
                            },
                        );
                    }
                    default:
                        return new Response(JSON.stringify({}), {
                            status: 404,
                            statusText: "Not Found",
                            headers: { "content-type": "application/json" },
                        });
                }
            } catch (e) {
                if (e instanceof MightBeJsonError)
                    return new Response(`${e}`, { status: 501, statusText: "JSON parsing not supported" });
                return new Response(`${e}\n${e.stack}`, { status: 400, statusText: "Bad Request" });
            }
        },
    });
}

main().finally(() => console.log("Finished"));
