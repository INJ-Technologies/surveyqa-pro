"""
Opt-Out and Mutually Exclusive Options Filter
Strictly prevents AI from choosing 'Don't know', 'None of the above', or other
opt-out anchors during QA testing unless specifically mandated by a test scenario.
"""
import re
from typing import List, Dict, Tuple, Any

# Regex patterns that indicate opt-out, ignorance, or negative anchor options
OPTOUT_PATTERNS = [
    r"\bdon'?t\s+know\b",
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
    r"\bother\s*\([^)]*specify[^)]*\)",
    r"\bother\s*\(please\s*state\)",
    r"\bplease\s*specify\b",
    r"^\s*other\s*$",
]


def is_optout_option(text: str) -> bool:
    """Returns True if the text represents an opt-out, 'don't know', or negative anchor."""
    if not text:
        return False
    t = text.strip().lower()
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
