"""
Opt-Out and Mutually Exclusive Options Filter
Strictly prevents AI from choosing 'Don't know', 'None of the above', or other
opt-out anchors during QA testing unless specifically mandated by a test scenario.
"""
import re
from typing import List, Dict, Tuple, Any, Optional

# Regex patterns that indicate opt-out, ignorance, or negative anchor options
OPTOUT_PATTERNS = [
    r"\bdon['’`]?t\s+know\b",
    r"\bdo\s+not\s+know\b",
    r"\bnot\s+sure\b",
    r"\bunsure\b",
    r"\bcannot\s+say\b",
    r"\bprefer\s+not\s+to\s+(say|answer|disclose)\b",
    r"\bdecline\s+to\s+(say|answer)\b",
    r"\bnone\s+of\s+(the\s+above|these|them)\b",
    r"^\s*none\s*$",
    r"\bnot\s+applicable\b",
    r"^\s*n/?a\s*$",
    r"\bno\s+significant\s+constraints?\b",
    r"\bno\s+clear\s+benefits?\b",
    r"\bno\s+formal\s+process\b",
    r"\bnone\s+of\s+the\s+above\s+are\s+dependent\b",
    r"\bwe\s+do\s+not\b",
    r"\bhave\s+no\s+plans?\b",
]

# Patterns for consent / mandatory legal checkboxes (MUST be ticked to proceed)
CONSENT_PATTERNS = [
    r"\bagree\b",
    r"\bterms\b",
    r"\bprivacy\b",
    r"\bconsent\b",
    r"\bconfirm\b",
    r"\b18\s*(years|yr|years\s+of\s+age)\b",
    r"\bi\s+have\s+read\b",
    r"\bi\s+understand\b",
    r"\beligible\b",
    r"\bdisclaimer\b",
]

# Patterns for "Other (please specify)"
SPECIFY_PATTERNS = [
    r"^\s*other(\b|\s*\(|\s*:|\s*,|\s*$|\s+please)",
    r"\bother\s*\([^)]*specify[^)]*\)",
    r"\bother\s*\(please\s*state\)",
    r"\bplease\s*specify\b",
    r"\(specify\)",
    r"\bspecify\s*:",
    r"\bwrite[- ]in\b",
    r"^\s*other\s*$",
]


def is_optout_option(text: str) -> bool:
    """Returns True if the text represents an opt-out, 'don't know', or negative anchor."""
    if not text:
        return False
    t = text.strip().lower().replace("’", "'").replace("`", "'")
    return any(re.search(p, t, re.IGNORECASE) for p in OPTOUT_PATTERNS)


def is_consent_checkbox(text: str) -> bool:
    """Returns True if the checkbox is a legal, privacy, or age consent checkbox."""
    if not text:
        return False
    t = text.strip().lower()
    return any(re.search(p, t, re.IGNORECASE) for p in CONSENT_PATTERNS)


def is_specify_option(text: str) -> bool:
    """Returns True if the option includes a specify/write-in request."""
    if not text:
        return False
    t = text.strip().lower()
    return any(re.search(p, t, re.IGNORECASE) for p in SPECIFY_PATTERNS)


def is_grid_other_row(row: Dict[str, Any]) -> bool:
    """
    Returns True if and only if this grid row is genuinely an 'Other / Specify' write-in row.
    Never matches regular sentences that happen to contain the word 'other'
    (e.g. 'Introduce or increase other card or account service charges').
    """
    if not row:
        return False
    if row.get("hasSpecify") or row.get("specifyId") or row.get("specifyName"):
        return True
    label = (row.get("rowLabel") or "").strip()
    return is_specify_option(label)


def separate_options(options: List[Dict[str, Any]]) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
    """
    Separates a list of option dicts into (substantive_options, optout_anchors).
    Each option dict typically contains {'index': int, 'label': str, ...}.
    """
    substantive = []
    optouts = []
    for opt in options:
        label = opt.get("label", "")
        if is_optout_option(label):
            optouts.append(opt)
        else:
            substantive.append(opt)
    return substantive, optouts


def filter_substantive_for_ai(
    options: List[Dict[str, Any]],
    allow_optout: bool = False
) -> List[Dict[str, Any]]:
    """
    Returns options eligible for AI consideration.
    If allow_optout is False (standard QA testing mode), opt-out anchors are completely stripped
    so the AI literally CANNOT select 'Don't know' or 'None of the above'.
    """
    if allow_optout:
        return options
    
    substantive, _ = separate_options(options)
    # If all options happen to be opt-outs (rare edge case), return original
    return substantive if substantive else options


def extract_numeric_range(text: str) -> Optional[Tuple[float, float]]:
    """
    Extracts (min_val, max_val) from strings like:
    '10,000 - 49,999', 'between 10000 and 49999', '5,000 to 9,999', '$1,000 - $5,000'.
    Also handles 'Less than 5,000' (0, 4999) or '100,000 or more' (100000, 200000).
    """
    if not text:
        return None
    clean = text.replace(",", "").replace("$", "").replace("€", "").replace("£", "").strip()

    # 1. 'between X and Y'
    m = re.search(r"between\s+(\d+(?:\.\d+)?)\s+and\s+(\d+(?:\.\d+)?)", clean, re.I)
    if m:
        return float(m.group(1)), float(m.group(2))

    # 2. 'X - Y' or 'X to Y'
    m = re.search(r"(\d+(?:\.\d+)?)\s*(?:-|–|—|to)\s*(\d+(?:\.\d+)?)", clean)
    if m:
        return float(m.group(1)), float(m.group(2))

    # 3. 'Less than X' or 'Under X'
    m = re.search(r"(?:less\s+than|under|<)\s*(\d+(?:\.\d+)?)", clean, re.I)
    if m:
        val = float(m.group(1))
        return 0.0, max(0.0, val - 1)

    # 4. 'X or more' or 'X+' or 'Over X' or 'More than X'
    m = re.search(r"(\d+(?:\.\d+)?)\s*(?:\+|or\s+more)", clean, re.I)
    if m:
        val = float(m.group(1))
        return val, val * 2.0
    m = re.search(r"(?:over|more\s+than|>)\s*(\d+(?:\.\d+)?)", clean, re.I)
    if m:
        val = float(m.group(1))
        return val + 1, (val + 1) * 2.0

    return None


def generate_humanized_number_in_range(min_val: float, max_val: float) -> int:
    """
    Generates a realistic, human-sounding rounded number within [min_val, max_val].
    Humans do not enter numbers like 10111 or 22343.
    They choose round numbers like 25000, 20000, 15000, or 30000.
    """
    if max_val < min_val:
        min_val, max_val = max_val, min_val
    diff = max_val - min_val
    if diff <= 0:
        return int(min_val)

    # Target 35% to 65% of the range (avoids hitting exact boundaries)
    target = min_val + diff * 0.45

    if diff >= 20000:
        step = 5000
    elif diff >= 5000:
        step = 1000
    elif diff >= 1000:
        step = 500
    elif diff >= 200:
        step = 50
    elif diff >= 50:
        step = 10
    elif diff >= 10:
        step = 5
    else:
        step = 1

    val = round(target / step) * step

    # Clamp strictly within [min_val, max_val]
    if val < min_val:
        val = min_val + step if min_val + step <= max_val else min_val
    if val > max_val:
        val = max_val - step if max_val - step >= min_val else max_val

    return int(val)
