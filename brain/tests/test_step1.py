import logging
from dataclasses import asdict

from federix.interfaces import ClientUpdate
from federix.logger import get_logger


def test_client_update_defaults():
    u = ClientUpdate(client_id="c-1", payload=("dense", None), num_samples=600)
    assert u.utility == 0.0 and u.ratio == 1.0 and "bytes_sent" in asdict(u)
    assert isinstance(u.client_id, str)


def _close(name):
    log = logging.getLogger(name)
    for h in list(log.handlers):
        h.close()
        log.removeHandler(h)
    logging.Logger.manager.loggerDict.pop(name, None)


def test_each_run_logs_to_its_own_file_and_earlier_logs_are_kept(tmp_path):
    first = get_logger("run_a", str(tmp_path))
    first.info("first run")
    path_a = first.log_path
    _close("run_a")
    second = get_logger("run_b", str(tmp_path))
    second.info("second run")
    path_b = second.log_path
    _close("run_b")

    assert path_a != path_b
    assert "first run" in open(path_a).read()
    assert "second run" in open(path_b).read()


def test_logger_appends_to_an_existing_file(tmp_path):
    log = get_logger("append_check", str(tmp_path))
    log.info("one")
    path = log.log_path
    for h in log.handlers:
        h.flush()
    with open(path, "a") as fh:
        fh.write("kept line\n")
    log.info("two")
    _close("append_check")
    text = open(path).read()
    assert "one" in text and "kept line" in text and "two" in text
