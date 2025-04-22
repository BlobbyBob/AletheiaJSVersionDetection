#include "tokenizer.h"

#include <tree_sitter/api.h>
#include <tree_sitter/tree-sitter-javascript.h>

namespace dolos {
    std::vector<uint16_t> tokenize(const std::span<const char> buffer) {
        TSParser *parser = ts_parser_new();
        ts_parser_set_language(parser, tree_sitter_javascript());
        TSTree *tree = ts_parser_parse_string(parser, nullptr, buffer.data(), buffer.size());
        TSTreeCursor cursor = ts_tree_cursor_new(ts_tree_root_node(tree));

        const auto COMMENT = ts_language_symbol_for_name(ts_parser_language(parser), "comment", 7, true);

        std::vector<uint16_t> tokens;

        while (true) {
            TSNode node = ts_tree_cursor_current_node(&cursor);
            const auto node_symbol = ts_node_symbol(node);

            // We skip leafs like Dolos does
            if (ts_node_child_count(node) > 0 && node_symbol != COMMENT) {
                tokens.emplace_back(node_symbol);
            }

            // This is pretty elegant:
            // 1. We check for child nodes
            // 2. If none exist, we check for siblings
            // 3. If none exist, we are done and move back to the parent
            // 4. The parent was already visited, so we need go to 2 again
            if (ts_tree_cursor_goto_first_child(&cursor) || ts_tree_cursor_goto_next_sibling(&cursor)) continue;
            bool done = false;
            while (ts_tree_cursor_goto_parent(&cursor)) {
                if (ts_tree_cursor_goto_next_sibling(&cursor)) {
                    done = true;
                    break;
                }
            }

            // There are no further siblings, so we visited everyone
            if (!done) break;
        }

        ts_tree_delete(tree);
        ts_parser_delete(parser);

        return tokens;
    }
}
