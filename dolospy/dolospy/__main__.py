import logging

from .dolospy import *

import argparse as __argparse
import logging as __logging

def __cpu_count() -> int:
    import os, sys

    if sys.version >= (3, 13):
        return os.process_cpu_count()
    else:
        return os.cpu_count()

def __main():
    logger = __logging.getLogger(__package__)

    parser = __argparse.ArgumentParser()
    parser.add_argument("command", choices=["preindexer"], help="command to execute")
    parser.add_argument("--preprocessor-url", type=str, help="http url to reach the preprocessor script")
    parser.add_argument(
        "--worker", type=int, default=0, help="number of worker processes. If non-positive, use number of CPU cores"
    )
    parser.add_argument("-k", type=int, default=27, help="length of k-grams")
    parser.add_argument("-w", type=int, default=15, help="window size")
    parser.add_argument(
        "--log-level",
        choices=["DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"],
        default="INFO",
        help="set the log level",
    )
    args = parser.parse_args()

    logger.setLevel(args.log_level)

    if args.command == "preindexer":
        __preindexer(args, logger)

def __preindexer(args: __argparse.Namespace, logger: __logging.Logger):
    import collections
    import concurrent.futures
    import os, time, sys

    from tqdm import tqdm

    npm_dir = os.getenv("NPM_DIR")
    index_dir = os.getenv("INDEX_DIR")

    logger.info(f"Using {args.preprocessor_url=}")
    logger.info(f"Using NPM_DIR={npm_dir!r}")
    logger.info(f"Using INDEX_DIR={index_dir!r}")

    package_versions = collections.defaultdict(list)
    for dirent in os.scandir(npm_dir):
        pkg, vers = dirent.name.rsplit("@", 1)
        package_versions[pkg].append(vers)

    for verss in package_versions.values():
        verss.sort(key=lambda v: tuple(map(int, v.split("."))))

    num_workers = args.worker
    if num_workers <= 0:
        num_workers = __cpu_count()
    logger.info(f"Running with {num_workers} workers")

    with concurrent.futures.ProcessPoolExecutor(max_workers=num_workers) as pool:
        futures = [
            pool.submit(__preindexer_worker, args, logger, pkg, verss) for pkg, verss in package_versions.items()
        ]

        progress_target = sys.stderr if logger.isEnabledFor(__logging.INFO) else open(os.path.devnull)
        progress = tqdm(total=len(futures), unit="packages", file=progress_target)
        while True:
            progress.n = sum(1 for f in futures if f.done())
            progress.update(0)
            if progress.n == len(futures):
                break
            time.sleep(0.4)
        progress.close()

        results = [future.result() for future in futures]

    import statistics

    logging.info("Preindexing statistics:")
    logging.info(f"  Min: {min(results)}")
    logging.info(f"  Mean: {statistics.mean(results)}")
    logging.info(f"  StdDev: {statistics.stdev(results)}")
    logging.info(f"  Median: {statistics.median(results)}")
    logging.info(f"  Max: {max(results)}")

def __preindexer_worker(args: __argparse.Namespace, logger: __logging.Logger, pkg: str, verss: list[str]):
    import os, time
    import urllib.parse

    import requests

    start = time.time()

    index_dir = os.getenv("INDEX_DIR")
    output = os.path.join(index_dir, f"{pkg}.index.json")
    index = Index(args.k, args.w)

    for vers in verss:
        logger.debug(f"Preprocessing {pkg} {vers}")
        resp = requests.get(f"{args.preprocessor_url}?{urllib.parse.urlencode({'pkg': pkg, 'version': vers})}")
        if resp.status_code != 200:
            logger.error(f"Preprocessor returned error for {pkg} {vers}")
            continue
        code = resp.json()
        logger.debug(f"Tokenizing and indexing {pkg} {vers} (size {len(code)})")
        index.addToGroup(vers, code)

    logger.debug(f"Writing {output.rsplit('/', 1)[-1]}")
    with open(output, "w") as f:
        f.write(index.serialize())

    return time.time() - start

if __name__ == "__main__":
    __main()
